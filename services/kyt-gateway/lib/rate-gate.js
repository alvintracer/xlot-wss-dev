const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class RateGate {
  constructor(requestsPerSecond = 8, now = () => Date.now()) {
    if (
      !Number.isInteger(requestsPerSecond) ||
      requestsPerSecond < 1 ||
      requestsPerSecond > 20
    ) {
      throw new Error("TranSight TPS limit must be between 1 and 20.");
    }
    this.intervalMs = Math.ceil(1000 / requestsPerSecond);
    this.now = now;
    this.nextStartAt = 0;
    this.queue = Promise.resolve();
  }

  async schedule(task) {
    const slot = this.queue.then(async () => {
      const delay = Math.max(0, this.nextStartAt - this.now());
      if (delay > 0) await wait(delay);
      this.nextStartAt = this.now() + this.intervalMs;
    });
    this.queue = slot.catch(() => undefined);
    await slot;
    return task();
  }
}
