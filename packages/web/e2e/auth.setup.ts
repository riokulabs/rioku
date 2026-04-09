import { test as setup } from '@playwright/test';

const adminFile = 'e2e/.auth/admin.json';
const viewerFile = 'e2e/.auth/viewer.json';
const operatorFile = 'e2e/.auth/operator.json';

setup('authenticate as admin', async ({ request }) => {
  await request.post('/api/v1/auth/login', {
    data: { username: 'testadmin', password: 'TestAdmin123!' },
  });
  await request.storageState({ path: adminFile });
});

setup('authenticate as viewer', async ({ request }) => {
  await request.post('/api/v1/auth/login', {
    data: { username: 'testviewer', password: 'TestView123!' },
  });
  await request.storageState({ path: viewerFile });
});

setup('authenticate as operator', async ({ request }) => {
  await request.post('/api/v1/auth/login', {
    data: { username: 'testoperator', password: 'TestOperator123!' },
  });
  await request.storageState({ path: operatorFile });
});
