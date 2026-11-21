import { DupCandidate, planMpuDuplicates } from './sales-cleanup';

const sale = (id: string, code: string, status: string, day: number, mpu = '3291', client = 'vf'): DupCandidate => ({
  id,
  client_id: client,
  mpu_id: mpu,
  sale_code: code,
  status,
  created_at: new Date(Date.UTC(2026, 6, day)),
});

describe('planMpuDuplicates (one live sale per client + MPU — §14 rule 8)', () => {
  it('keeps the oldest copy and removes the re-imports', () => {
    const plan = planMpuDuplicates([
      sale('b', '2026-07-03-MPU-3291-VF-1', 'validated', 5),
      sale('a', '2026-07-03-MPU-3291-VF', 'validated', 4),
    ]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].keep.id).toBe('a');
    expect(plan.groups[0].remove.map((s) => s.id)).toEqual(['b']);
  });

  it('on the same timestamp keeps the code without the -N suffix', () => {
    const plan = planMpuDuplicates([sale('b', 'X-VF-1', 'entered', 4), sale('a', 'X-VF', 'entered', 4)]);
    expect(plan.groups[0].keep.id).toBe('a');
  });

  it('keeps the single paid copy even when it is newer (a paid snapshot is never removed, #2)', () => {
    const plan = planMpuDuplicates([sale('a', 'X-VF', 'validated', 4), sale('b', 'X-VF-1', 'paid', 9)]);
    expect(plan.groups[0].keep.id).toBe('b');
    expect(plan.groups[0].remove.map((s) => s.id)).toEqual(['a']);
  });

  it('reports, but never touches, a group with two paid copies', () => {
    const plan = planMpuDuplicates([sale('a', 'X', 'paid', 4), sale('b', 'X-1', 'clawed_back', 5)]);
    expect(plan.groups).toHaveLength(0);
    expect(plan.blocked).toHaveLength(1);
  });

  it('matches MPU case- and space-insensitively, per client, and ignores no-MPU and deleted sales', () => {
    const plan = planMpuDuplicates([
      sale('a', 'A', 'validated', 4, 'mpu-1'),
      sale('b', 'B', 'validated', 5, ' MPU-1 '),
      sale('c', 'C', 'validated', 5, 'MPU-1', 'rf'), // another client: a different household
      sale('d', 'D', 'deleted', 6, 'MPU-1'),
      { ...sale('e', 'E', 'validated', 6), mpu_id: null },
      { ...sale('f', 'F', 'validated', 6), mpu_id: null },
    ]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].remove.map((s) => s.id)).toEqual(['b']);
  });
});
