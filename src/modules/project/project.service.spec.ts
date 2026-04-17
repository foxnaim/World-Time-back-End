import { ProjectService } from './project.service';

/**
 * Unit tests for ProjectService.monthlySummary insight branching.
 *
 * The insight string is the headline B2C "реальная ставка" feature, with
 * RUB rate bands at <500 / 500–1500 / 1500–3000 / >3000. We cover each
 * band by varying declared rate × hours so the derived real rate lands
 * in the target bucket.
 */

function makePrisma(project: any, totalSeconds: number) {
  return {
    project: {
      findUnique: jest.fn(async () => project),
    },
    timeEntry: {
      aggregate: jest.fn(async () => ({
        _sum: { durationSec: totalSeconds },
        _count: { _all: 1 },
      })),
    },
  };
}

const baseProject = {
  id: 'proj-1',
  userId: 'user-1',
  name: 'Landing page',
  description: null,
  hourlyRate: null,
  fixedPrice: null,
  currency: 'RUB',
  status: 'ACTIVE',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

/**
 * Build a project whose 10-hour month produces `rate` ₽/hour as the
 * realHourlyRate. The insight builder compares declaredRate to real rate;
 * we set them equal so only the band text matters.
 */
function projectForRate(rate: number) {
  return { ...baseProject, hourlyRate: rate };
}

describe('ProjectService.monthlySummary — insight branches', () => {
  const TEN_HOURS_SEC = 10 * 3600;

  async function summaryFor(project: any): Promise<string> {
    const prisma = makePrisma(project, TEN_HOURS_SEC);
    const service = new ProjectService(prisma as any);
    const result = await service.monthlySummary('user-1', 'proj-1', '2025-03');
    return result.insight;
  }

  it('< 500 ₽/час: below-market band', async () => {
    const insight = await summaryFor(projectForRate(300));
    expect(insight).toMatch(/ниже рынка/);
  });

  it('500–1500 ₽/час: newbie-mid band', async () => {
    const insight = await summaryFor(projectForRate(1000));
    expect(insight).toMatch(/новичка/);
  });

  it('1500–3000 ₽/час: solid market band', async () => {
    const insight = await summaryFor(projectForRate(2000));
    expect(insight).toMatch(/хорошая рыночная ставка/);
  });

  it('> 3000 ₽/час: top-rate band', async () => {
    const insight = await summaryFor(projectForRate(5000));
    expect(insight).toMatch(/топ-ставка/);
  });

  it('returns "no time" message when total seconds is 0', async () => {
    const prisma = makePrisma(projectForRate(2000), 0);
    const service = new ProjectService(prisma as any);
    const result = await service.monthlySummary('user-1', 'proj-1', '2025-03');
    expect(result.insight).toMatch(/нет записанного времени/);
  });
});
