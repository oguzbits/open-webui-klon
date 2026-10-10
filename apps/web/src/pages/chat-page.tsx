import { useParams } from 'react-router';

import { ChatView } from '@/features/chats/chat-view';

export function ChatPage() {
  const { id } = useParams();
  if (id === undefined) throw new Error('The chat route has no id');
  // The key gives every chat its own session: no running state carries over from the chat before.
  return <ChatView key={id} chatId={id} />;
}
