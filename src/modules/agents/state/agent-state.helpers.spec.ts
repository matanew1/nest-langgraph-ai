import {
  getAgentCounters,
  incrementAgentCounters,
  DEFAULT_AGENT_COUNTERS,
} from './agent-state.helpers';
import { AgentCounters } from './agent.state';

describe('DEFAULT_AGENT_COUNTERS', () => {
  it('has all counter fields set to 0', () => {
    expect(DEFAULT_AGENT_COUNTERS).toEqual({
      turn: 0,
      toolCalls: 0,
      replans: 0,
      stepRetries: 0,
      supervisorFallbacks: 0,
    });
  });
});

describe('getAgentCounters', () => {
  it('returns defaults when called with no arguments', () => {
    const counters = getAgentCounters();
    expect(counters).toEqual(DEFAULT_AGENT_COUNTERS);
  });

  it('returns defaults when called with undefined', () => {
    const counters = getAgentCounters(undefined);
    expect(counters).toEqual(DEFAULT_AGENT_COUNTERS);
  });

  it('returns defaults when called with empty object', () => {
    const counters = getAgentCounters({});
    expect(counters).toEqual(DEFAULT_AGENT_COUNTERS);
  });

  it('merges partial counters with defaults', () => {
    const counters = getAgentCounters({ turn: 3, replans: 1 });
    expect(counters).toEqual({
      turn: 3,
      toolCalls: 0,
      replans: 1,
      stepRetries: 0,
      supervisorFallbacks: 0,
    });
  });

  it('overrides all defaults when full counters are provided', () => {
    const full: AgentCounters = {
      turn: 5,
      toolCalls: 10,
      replans: 2,
      stepRetries: 3,
      supervisorFallbacks: 1,
    };
    const counters = getAgentCounters(full);
    expect(counters).toEqual(full);
  });

  it('does not mutate DEFAULT_AGENT_COUNTERS', () => {
    getAgentCounters({ turn: 99 });
    expect(DEFAULT_AGENT_COUNTERS.turn).toBe(0);
  });
});

describe('incrementAgentCounters', () => {
  it('increments a single counter field', () => {
    const current: AgentCounters = {
      turn: 2,
      toolCalls: 5,
      replans: 0,
      stepRetries: 1,
      supervisorFallbacks: 0,
    };
    const result = incrementAgentCounters(current, { turn: 1 });
    expect(result.turn).toBe(3);
    expect(result.toolCalls).toBe(5);
    expect(result.replans).toBe(0);
  });

  it('increments multiple counter fields at once', () => {
    const current: AgentCounters = {
      turn: 1,
      toolCalls: 2,
      replans: 0,
      stepRetries: 0,
      supervisorFallbacks: 0,
    };
    const result = incrementAgentCounters(current, {
      toolCalls: 3,
      replans: 1,
    });
    expect(result.toolCalls).toBe(5);
    expect(result.replans).toBe(1);
    expect(result.turn).toBe(1);
  });

  it('treats undefined current counters as defaults (all zeros)', () => {
    const result = incrementAgentCounters(undefined, { turn: 1, toolCalls: 2 });
    expect(result).toEqual({
      turn: 1,
      toolCalls: 2,
      replans: 0,
      stepRetries: 0,
      supervisorFallbacks: 0,
    });
  });

  it('returns unchanged counters when delta is all zeros', () => {
    const current: AgentCounters = {
      turn: 5,
      toolCalls: 3,
      replans: 1,
      stepRetries: 2,
      supervisorFallbacks: 0,
    };
    const result = incrementAgentCounters(current, {
      turn: 0,
      toolCalls: 0,
      replans: 0,
      stepRetries: 0,
      supervisorFallbacks: 0,
    });
    expect(result).toEqual(current);
  });

  it('returns unchanged counters when delta is empty object', () => {
    const current: AgentCounters = {
      turn: 3,
      toolCalls: 1,
      replans: 0,
      stepRetries: 0,
      supervisorFallbacks: 0,
    };
    const result = incrementAgentCounters(current, {});
    expect(result).toEqual(current);
  });

  it('increments supervisorFallbacks correctly', () => {
    const current: AgentCounters = {
      turn: 0,
      toolCalls: 0,
      replans: 0,
      stepRetries: 0,
      supervisorFallbacks: 2,
    };
    const result = incrementAgentCounters(current, { supervisorFallbacks: 1 });
    expect(result.supervisorFallbacks).toBe(3);
  });

  it('does not mutate the input counters object', () => {
    const current: AgentCounters = {
      turn: 1,
      toolCalls: 0,
      replans: 0,
      stepRetries: 0,
      supervisorFallbacks: 0,
    };
    const original = { ...current };
    incrementAgentCounters(current, { turn: 5 });
    expect(current).toEqual(original);
  });
});
