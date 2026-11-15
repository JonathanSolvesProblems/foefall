// Devvit Journeys, wrapped so telemetry can never break play. Events follow Reddit's guidance: start on an explicit
// Begin, progress on committed hero actions, interactions on undo, reset and help, end on a cleared trial.
import { telemetry } from '@devvit/analytics/client/reddit';

const quiet = (p: Promise<unknown>) => {
  p.then((r) => {
    const status = (r as { receipt?: { status?: string } } | undefined)?.receipt?.status;
    if (status && status !== 'JOURNEY_RECEIPT_VALID') console.info('[journey]', status);
  }).catch(() => undefined);
};

let started = false;

export const journey = {
  ready() {
    quiet(telemetry.appReady());
  },
  start() {
    if (started) return;
    started = true;
    quiet(telemetry.startJourney());
  },
  progress(progress: number, action: string) {
    quiet(telemetry.progress({ progress: Math.min(0.95, Math.max(0, progress)), action }));
  },
  interaction(action: string, actionDetails?: string) {
    quiet(telemetry.interaction(actionDetails ? { action, actionDetails } : { action }));
  },
  end(win: boolean, score: number) {
    quiet(telemetry.endJourney({ complete: win, game: { win, score } }));
    started = false;
  },
};
