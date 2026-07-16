let fakeNow: number | null = null;
let realDateNow: typeof Date.now | null = null;

export function setFakeNow(iso: string | null): void {
  if (iso == null) {
    if (realDateNow) Date.now = realDateNow;
    fakeNow = null;
    realDateNow = null;
    return;
  }
  if (!realDateNow) realDateNow = Date.now;
  fakeNow = new Date(iso).getTime();
  Date.now = () => fakeNow!;
}

export function advanceFakeClock(hours: number): void {
  if (fakeNow == null) {
    setFakeNow(new Date().toISOString());
  }
  fakeNow! += hours * 60 * 60 * 1000;
}
