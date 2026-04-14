import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.scss';

export default function Home(): React.JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout description={siteConfig.tagline}>
      <main className={styles.hero}>
        <img
          src="/img/favicon.svg"
          alt="Rioku"
          className={styles.logo}
        />
        <h1 className={styles.title}>Rioku Contributors</h1>
        <p className={styles.tagline}>{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--primary button--lg"
            to="/docs/getting-started"
          >
            Get Started
          </Link>
          <Link
            className="button button--secondary button--lg"
            href="https://github.com/riokulabs/rioku"
          >
            GitHub
          </Link>
        </div>
      </main>
    </Layout>
  );
}
