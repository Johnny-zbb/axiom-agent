export async function retry(operation, maxAttempts) {
  let lastError;
  for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
