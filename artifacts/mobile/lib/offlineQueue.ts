import AsyncStorage from "@react-native-async-storage/async-storage";
import { createLead } from "./api";
import type { CreateLeadInput } from "./types";

const QUEUE_KEY = "@pending_leads";

export type PendingLead = CreateLeadInput & {
  _id: string;
  _enqueuedAt: string;
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function enqueueLead(data: CreateLeadInput): Promise<void> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  const queue: PendingLead[] = raw ? JSON.parse(raw) : [];
  queue.push({
    ...data,
    _id: generateId(),
    _enqueuedAt: new Date().toISOString(),
  });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getPendingLeads(): Promise<PendingLead[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function getPendingCount(): Promise<number> {
  const queue = await getPendingLeads();
  return queue.length;
}

export async function removePendingLead(id: string): Promise<void> {
  const queue = await getPendingLeads();
  const filtered = queue.filter((l) => l._id !== id);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

export async function processQueue(onProgress?: (message: string) => void): Promise<void> {
  const queue = await getPendingLeads();
  if (queue.length === 0) return;

  for (const pending of queue) {
    try {
      await createLead(pending);
      await removePendingLead(pending._id);
      onProgress?.(`Synced lead: ${pending.name}`);
    } catch (err) {
      onProgress?.(`Failed to sync ${pending.name}: ${err instanceof Error ? err.message : String(err)}`);
      // Stop processing on first failure to avoid spamming the server
      break;
    }
  }
}
