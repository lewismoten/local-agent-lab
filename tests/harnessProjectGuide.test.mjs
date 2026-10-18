import test from 'node:test';
import assert from 'node:assert/strict';
import { projectWithGuide } from '../src/harnessProjectGuide.ts';

class Directory {
  children = new Map();
  async getDirectoryHandle(name) {
    const child = this.children.get(name);
    if (!child) throw new DOMException('Missing folder', 'NotFoundError');
    return child;
  }
  async getFileHandle(name) {
    const file = this.children.get(name);
    if (!file) throw new DOMException('Missing file', 'NotFoundError');
    return { getFile: async () => file };
  }
  add(path, content) {
    const parts = path.split('/');
    let parent = this;
    for (const part of parts.slice(0, -1)) {
      if (!parent.children.has(part)) parent.children.set(part, new Directory());
      parent = parent.children.get(part);
    }
    parent.children.set(parts.at(-1), new File([content], parts.at(-1)));
  }
}

const project = { id: 'home', name: 'Demo', description: '', instructions: 'Use TypeScript.', filesPath: 'repositories/demo' };

test('a mapped project reads its AGENTS.md fresh for each model request', async () => {
  const folder = new Directory();
  folder.add('repositories/demo/AGENTS.md', 'Run the parser tests.');
  const first = await projectWithGuide(folder, project);
  assert.equal(first.instructions, 'Use TypeScript.');
  assert.match(first.guide, /Run the parser tests/);
  assert.equal(project.instructions, 'Use TypeScript.');
  folder.add('repositories/demo/AGENTS.md', 'Run the compiler tests.');
  const second = await projectWithGuide(folder, project);
  assert.match(second.guide, /Run the compiler tests/);
  assert.doesNotMatch(second.guide, /parser tests/);
});

test('project guides remain inside the assigned file area', async () => {
  const folder = new Directory();
  folder.add('harness/projects/home/files/AGENTS.md', 'Review each change.');
  const unmapped = { ...project, filesPath: '' };
  assert.match((await projectWithGuide(folder, unmapped)).guide, /Review each change/);
  assert.equal(await projectWithGuide(folder, project), project);
  await assert.rejects(projectWithGuide(folder, { ...project, filesPath: '../other' }), /relative path/);
});

test('oversized guides stop the model run rather than silently truncating instructions', async () => {
  const folder = new Directory();
  folder.add('repositories/demo/AGENTS.md', 'x'.repeat(16 * 1024 + 1));
  await assert.rejects(projectWithGuide(folder, project), /larger than 16 KB/);
});
