import { describe, expect, it } from 'vitest';

import { UnavailableConnectionDtoReason } from '@/api/generated/model';
import { modelDto, modelList, providerConnectionDto } from '@/test/fixtures';

import {
  CONNECTION_STATUS,
  connectionStatus,
  unreachableReason,
  visibleModelCount,
} from './connection-status';

const LOCAL = providerConnectionDto({ id: 'c-local' });
const HEALTHY = modelList([
  modelDto({ id: 'c-local:a', connectionId: 'c-local' }),
  modelDto({ id: 'c-local:b', connectionId: 'c-local' }),
  modelDto({ id: 'c-other:c', connectionId: 'c-other' }),
]);
const DOWN = modelList(
  [],
  [{ id: 'c-local', name: 'Lokal', reason: UnavailableConnectionDtoReason.timeout }]
);

describe('connectionStatus', () => {
  it('is disabled for a disabled connection, whatever the server says', () => {
    const off = providerConnectionDto({ id: 'c-local', enabled: false });
    expect(connectionStatus(off, HEALTHY)).toBe(CONNECTION_STATUS.DISABLED);
    expect(connectionStatus(off, undefined)).toBe(CONNECTION_STATUS.DISABLED);
    expect(connectionStatus(off, DOWN)).toBe(CONNECTION_STATUS.DISABLED);
  });

  it('is active when the model list names no problem for it', () => {
    expect(connectionStatus(LOCAL, HEALTHY)).toBe(CONNECTION_STATUS.ACTIVE);
  });

  it('is unreachable when the model list names it as unavailable', () => {
    expect(connectionStatus(LOCAL, DOWN)).toBe(CONNECTION_STATUS.UNREACHABLE);
  });

  it('is unknown while the health of the providers is not known', () => {
    expect(connectionStatus(LOCAL, undefined)).toBe(CONNECTION_STATUS.UNKNOWN);
  });
});

describe('unreachableReason', () => {
  it('gives the reason only for an enabled, unreachable connection', () => {
    expect(unreachableReason(LOCAL, DOWN)).toBe(UnavailableConnectionDtoReason.timeout);
    expect(unreachableReason(LOCAL, HEALTHY)).toBeUndefined();
    expect(unreachableReason(LOCAL, undefined)).toBeUndefined();
    expect(
      unreachableReason(providerConnectionDto({ id: 'c-local', enabled: false }), DOWN)
    ).toBeUndefined();
  });
});

describe('visibleModelCount', () => {
  it('counts only the models of this connection', () => {
    expect(visibleModelCount(LOCAL, HEALTHY)).toBe(2);
  });

  it('counts zero for an active connection without visible models', () => {
    expect(visibleModelCount(LOCAL, modelList([]))).toBe(0);
  });

  it('has no count when the connection is not active or its health is unknown', () => {
    expect(visibleModelCount(LOCAL, DOWN)).toBeUndefined();
    expect(visibleModelCount(LOCAL, undefined)).toBeUndefined();
    expect(
      visibleModelCount(providerConnectionDto({ id: 'c-local', enabled: false }), HEALTHY)
    ).toBeUndefined();
  });
});
