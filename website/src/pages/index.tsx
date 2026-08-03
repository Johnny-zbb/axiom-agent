import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import HomepageFeatures from '@site/src/components/HomepageFeatures';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  const bannerUrl = useBaseUrl('/img/axiom-agent-banner.png');

  return (
    <header
      className={styles.heroBanner}
      style={{backgroundImage: `url("${bannerUrl}")`}}>
      <div className={styles.heroOverlay} />
      <div className={`container ${styles.heroContent}`}>
        <p className={styles.eyebrow}>Agent Engineering · 实践与研究</p>
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <p className={styles.heroDescription}>
          从一次模型调用出发，逐步理解 Runtime、Context、Tools、Memory
          如何共同构成一个可靠的 Agent 系统。
        </p>
        <div className={styles.buttons}>
          <Link className={styles.primaryButton} to="/docs/">
            开始阅读
            <span aria-hidden="true">→</span>
          </Link>
          <Link
            className={styles.secondaryButton}
            to="/docs/concepts/from-llm-api-to-axiom-agent">
            阅读第一章
          </Link>
        </div>
      </div>
    </header>
  );
}

function AuthorNote() {
  const avatarUrl = useBaseUrl('/img/axiom-agent-avatar.png');

  return (
    <section className={styles.authorSection}>
      <div className={`container ${styles.authorInner}`}>
        <img
          className={styles.avatar}
          src={avatarUrl}
          alt="Axiom Agent 个人形象"
        />
        <div>
          <p className={styles.authorKicker}>Built from practice</p>
          <Heading as="h2">从真实 Agent 工程问题出发</Heading>
          <p>
            这里不只整理 API
            用法，更关注状态如何延续、工具如何受控、上下文如何构建，以及系统为什么会演化成今天的样子。
          </p>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();

  return (
    <Layout
      title={siteConfig.title}
      description="Axiom Agent 工程实践与研究文档">
      <HomepageHeader />
      <main>
        <AuthorNote />
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
