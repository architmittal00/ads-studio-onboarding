'use client';
import { useSyncExternalStore } from 'react';
import type { GraphCall } from './types';

/** One request from this app's UI to its own /api/meta route, with the Graph calls it triggered. */
export interface LogGroup {
  id: string;
  at: number;
  method: 'GET' | 'POST';
  action: string;
  input: unknown;
  status: number;
  ms: number;
  ok: boolean;
  output?: unknown;
  calls: GraphCall[];
}

const MAX_GROUPS = 100;
const MAX_OUTPUT_CHARS = 40_000;

interface State { groups: LogGroup[]; open: boolean }
let state: State = { groups: [], open: false };
const listeners = new Set<() => void>();

// Kept in memory only: nothing is stored in the browser, so the log clears on reload.
function persist() { /* intentionally nothing */ }

function emit() { listeners.forEach((l) => l()); }

function clip(value: unknown): unknown {
  try {
    const text = JSON.stringify(value);
    return text && text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}…` : value;
  } catch { return String(value); }
}

export function addLogGroup(g: Omit<LogGroup, 'id'>) {
  const group: LogGroup = { ...g, id: `${g.at}-${Math.random().toString(36).slice(2, 8)}`, input: clip(g.input), output: clip(g.output) };
  state = { ...state, groups: [group, ...state.groups].slice(0, MAX_GROUPS) };
  persist();
  emit();
}

export function clearLog() { state = { ...state, groups: [] }; persist(); emit(); }
export function setLogOpen(open: boolean) { state = { ...state, open }; emit(); }
export function toggleLog() { setLogOpen(!state.open); }

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const EMPTY: State = { groups: [], open: false };

export function useApiLog(): State {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}
