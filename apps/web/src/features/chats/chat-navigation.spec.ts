import { describe, expect, it } from 'vitest';

import { firstMessageState, readFirstMessage } from './chat-navigation';

describe('first message in the router state', () => {
  it('hands the text over', () => {
    expect(readFirstMessage(firstMessageState('Hallo'))).toBe('Hallo');
  });

  it.each([null, undefined, 'Hallo', 5, {}, { firstMessage: 5 }, { firstMessage: '   ' }])(
    'ignores %j',
    (state) => {
      expect(readFirstMessage(state)).toBeUndefined();
    }
  );
});
