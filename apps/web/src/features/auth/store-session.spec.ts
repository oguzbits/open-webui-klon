import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { getAuthMeQueryKey } from '@/api/generated/api';
import { sessionInfo, userDto } from '@/test/fixtures';

import { storeSession } from './store-session';

describe('storeSession', () => {
  it('drops everything cached for the previous user and keeps only the new session', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(getAuthMeQueryKey(), {
      data: sessionInfo(userDto({ id: 'old' })),
      status: 200,
    });
    queryClient.setQueryData(['/api/users'], { data: [userDto({ id: 'secret' })] });
    queryClient.setQueryData(['/api/auth/api-keys'], { data: [] });

    storeSession(queryClient, sessionInfo(userDto({ id: 'new' })));

    expect(queryClient.getQueryData(['/api/users'])).toBeUndefined();
    expect(queryClient.getQueryData(['/api/auth/api-keys'])).toBeUndefined();
    expect(queryClient.getQueryData(getAuthMeQueryKey())).toMatchObject({
      data: { user: { id: 'new' } },
      status: 200,
    });
  });
});
