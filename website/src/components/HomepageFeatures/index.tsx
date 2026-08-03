import type {ReactNode} from 'react';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

const FeatureList = [
  {
    index: '01',
    title: 'Agent Runtime',
    description: '探索 Agent Loop、状态管理与执行轨迹等核心运行机制。',
  },
  {
    index: '02',
    title: 'Context Engineering',
    description: '研究上下文构建、记忆系统与 Token Budget 对 Agent 决策的影响。',
  },
  {
    index: '03',
    title: 'Tool Runtime',
    description: '实现工具校验、执行、错误处理与可观测性等工程能力。',
  },
];

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.heading}>
          <p>System map</p>
          <Heading as="h2">从模型能力走向工程系统</Heading>
        </div>
        <div className={styles.grid}>
          {FeatureList.map((feature) => (
            <article className={styles.card} key={feature.index}>
              <div className={styles.cardHeader}>
                <span>{feature.index}</span>
                <i aria-hidden="true" />
              </div>
              <Heading as="h3">{feature.title}</Heading>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
