import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptSourceFindings, emptyStoryGraph } from '../src/model.ts';

test('accept all changes only current, proposed findings from one source', () => {
  const graph = {
    ...emptyStoryGraph(),
    units: [
      { id: 'u1', sourceId: 'a', status: 'proposed', title: 'Book one' },
      { id: 'u2', sourceId: 'b', status: 'proposed', title: 'Other document' },
      { id: 'u3', sourceId: 'a', status: 'dismissed', title: 'Rejected' },
      { id: 'u4', sourceId: 'a', status: 'proposed', stale: true, title: 'Changed evidence' },
    ],
    arcs: [{ id: 'a1', sourceId: 'a', status: 'proposed' }],
    mentions: [{ id: 'm1', sourceId: 'a', status: 'accepted' }],
    events: [{ id: 'e1', sourceId: 'a', status: 'proposed' }],
    suggestions: [{ id: 's1', sourceId: 'a', status: 'proposed' }],
  };
  const accepted = acceptSourceFindings(graph, 'a');
  assert.deepEqual(accepted.units.map(x => x.status), ['accepted', 'proposed', 'dismissed', 'proposed']);
  assert.equal(accepted.arcs[0].status, 'accepted');
  assert.equal(accepted.mentions[0].status, 'accepted');
  assert.equal(accepted.events[0].status, 'accepted');
  assert.equal(accepted.suggestions[0].status, 'proposed');
  assert.equal(graph.units[0].status, 'proposed');
});
