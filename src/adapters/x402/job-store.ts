export type JobStatus = "accepted" | "running" | "completed" | "failed";

export interface JobRecord {
  id: string;
  status: JobStatus;
  updatedAt: string;
}

export class JobStore {
  private readonly jobs = new Map<string, JobRecord>();

  create(id: string): JobRecord {
    const job = { id, status: "accepted" as const, updatedAt: new Date().toISOString() };
    this.jobs.set(id, job);
    return job;
  }

  setStatus(id: string, status: JobStatus): JobRecord {
    if (!this.jobs.has(id)) {
      throw new Error(`Unknown job: ${id}`);
    }
    const job = { id, status, updatedAt: new Date().toISOString() };
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }
}
