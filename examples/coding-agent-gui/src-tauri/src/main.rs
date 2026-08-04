// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(debug_assertions)]
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{Manager, RunEvent};

struct ServerChild(Mutex<Option<Child>>);

#[cfg_attr(debug_assertions, allow(unused_variables))]
fn sidecar_command(app: &tauri::AppHandle) -> Command {
    let mut command;
    #[cfg(debug_assertions)]
    {
        // Dev: run the Node sidecar from the example root so changes apply instantly.
        let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
        let example_root = manifest
            .parent()
            .expect("src-tauri has a parent directory")
            .to_path_buf();
        let node = std::env::var("AXIOM_NODE").unwrap_or_else(|_| "node".into());
        let workspace =
            std::env::var("AXIOM_GUI_WORKSPACE").unwrap_or_else(|_| example_root.to_string_lossy().into_owned());
        command = Command::new(node);
        command.arg("server.mjs").current_dir(&example_root).env("AXIOM_WORKSPACE", workspace);
    }
    #[cfg(not(debug_assertions))]
    {
        // Release: bundled single-file sidecar binary.
        let resource = app.path().resource_dir().expect("resource dir");
        let exe = resource.join(if cfg!(windows) { "agent-server.exe" } else { "agent-server" });
        let workspace = std::env::var("AXIOM_GUI_WORKSPACE").unwrap_or_else(|_| {
            std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .unwrap_or_else(|_| "C:\\".into())
        });
        command = Command::new(exe);
        command.env("AXIOM_WORKSPACE", workspace);
    }
    command
        .env("AXIOM_SIDECAR", "1")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let child = sidecar_command(&handle)
                .spawn()
                .expect("failed to spawn the sidecar server");
            app.manage(ServerChild(Mutex::new(Some(child))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<ServerChild>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}
