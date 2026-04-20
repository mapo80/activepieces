import { InteractiveFlowPhase } from '@activepieces/shared';

const PHASE_PALETTE = [
  {
    ribbon: 'bg-blue-500',
    chip: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
    border: 'border-blue-300 dark:border-blue-700',
  },
  {
    ribbon: 'bg-emerald-500',
    chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
    border: 'border-emerald-300 dark:border-emerald-700',
  },
  {
    ribbon: 'bg-amber-500',
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
    border: 'border-amber-300 dark:border-amber-700',
  },
  {
    ribbon: 'bg-violet-500',
    chip: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100',
    border: 'border-violet-300 dark:border-violet-700',
  },
  {
    ribbon: 'bg-rose-500',
    chip: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100',
    border: 'border-rose-300 dark:border-rose-700',
  },
  {
    ribbon: 'bg-cyan-500',
    chip: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-100',
    border: 'border-cyan-300 dark:border-cyan-700',
  },
] as const;

const DEFAULT_COLORS = {
  ribbon: 'bg-muted',
  chip: 'bg-muted text-muted-foreground',
  border: 'border-border',
} as const;

type PhaseColor = {
  ribbon: string;
  chip: string;
  border: string;
};

function getPhaseColor(params: {
  phaseId: string | undefined;
  phases: InteractiveFlowPhase[] | undefined;
}): PhaseColor {
  const { phaseId, phases } = params;
  if (!phaseId || !phases) return DEFAULT_COLORS;
  const index = phases.findIndex((p) => p.id === phaseId);
  if (index < 0) return DEFAULT_COLORS;
  return PHASE_PALETTE[index % PHASE_PALETTE.length];
}

function getPhaseLabel(params: {
  phaseId: string | undefined;
  phases: InteractiveFlowPhase[] | undefined;
}): string | undefined {
  const { phaseId, phases } = params;
  if (!phaseId || !phases) return undefined;
  const index = phases.findIndex((p) => p.id === phaseId);
  if (index < 0) return undefined;
  return phases[index].name;
}

function getPhaseIndex(params: {
  phaseId: string | undefined;
  phases: InteractiveFlowPhase[] | undefined;
}): number {
  const { phaseId, phases } = params;
  if (!phaseId || !phases) return -1;
  return phases.findIndex((p) => p.id === phaseId);
}

export const phaseColors = {
  get: getPhaseColor,
  getLabel: getPhaseLabel,
  getIndex: getPhaseIndex,
  palette: PHASE_PALETTE,
  defaults: DEFAULT_COLORS,
};
