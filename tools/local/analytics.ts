// Stand-in for @devvit/analytics/client/reddit in the local preview: logs each Journeys event.
const ok = async (name: string, payload?: unknown) => {
  console.log('[journey]', name, payload ?? '');
  return { receipt: { status: 'LOCAL', message: 'local preview' } };
};

export const telemetry = {
  appReady: () => ok('app.ready'),
  startJourney: async () => ({ journeyId: 'local', ...(await ok('journey.start')) }),
  progress: (p: unknown) => ok('journey.progress', p),
  interaction: (p: unknown) => ok('journey.interaction', p),
  endJourney: (p: unknown) => ok('journey.end', p),
};
