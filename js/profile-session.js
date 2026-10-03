// A result belongs to one exact source/browser/profile. Never persist session identities.
export function createProfileSessionController({ probe, onState }) {
  let controller = null;
  let version = 0;
  return {
    async refresh(settings) {
      controller?.abort();
      controller = new AbortController();
      const current = ++version;
      const snapshot = { ...settings };
      onState({ status: 'checking', settings: snapshot });
      try {
        const result = await probe(snapshot, controller.signal);
        if (current !== version) return;
        onState({ ...result, status: result?.authenticated ? 'authenticated' : result?.status || 'signed-out', settings: snapshot });
      } catch (error) {
        if (current !== version) return;
        onState({ status: 'unknown', error: error.message, settings: snapshot });
      }
    },
    cancel() { ++version; controller?.abort(); },
  };
}
