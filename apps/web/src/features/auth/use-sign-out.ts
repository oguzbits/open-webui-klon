import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { useAuthLogout } from '@/api/generated/api';

/** Ends the session on the server, forgets everything cached for this user and goes to the sign-in page. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useAuthLogout({
    mutation: {
      onSuccess: () => {
        queryClient.removeQueries();
        void navigate('/login', { replace: true });
      },
    },
  });
}
