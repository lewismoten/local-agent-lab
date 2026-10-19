import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceFileName, workspacePathParts } from '../src/workspacePath.ts';
import { readBlob, removeBlob, writeBlob, writeStream } from '../src/storage.ts';
import { newProject, parseProjectFiles, projectFiles } from '../src/model.ts';

test('workspace file paths stay relative to their selected folder', () => {
  assert.deepEqual(workspacePathParts('harness/projects/story/media/scene 1.png'), ['harness', 'projects', 'story', 'media', 'scene 1.png']);
  for (const path of ['', '/media/file.png', '../file.png', 'media/../file.png', './file.png', 'media//file.png', 'media/', 'C:/file.png', 'media\\file.png', 'file\nname.png'])
    assert.throws(() => workspacePathParts(path), TypeError, path);
});

test('single file handles reject path components', () => {
  assert.equal(workspaceFileName('Granite-4.1-Q4_K_M.gguf'), 'Granite-4.1-Q4_K_M.gguf');
  for (const name of ['', '.', '..', '.gguf/other', 'models/file.gguf', '../file.gguf', 'C:/file.gguf', 'file\\name', 'file\nname'])
    assert.throws(() => workspaceFileName(name), TypeError, name);
});

test('file operations reject unsafe paths before touching the folder', async () => {
  let touched = false;
  const folder = { getDirectoryHandle() { touched = true; throw new Error('unexpected directory access'); }, getFileHandle() { touched = true; throw new Error('unexpected file access'); } };
  await assert.rejects(writeBlob(folder, '../outside.txt', new Blob(['text'])), TypeError);
  await assert.rejects(writeStream(folder, '/outside.txt', async () => {}), TypeError);
  await assert.rejects(readBlob(folder, 'C:/outside.txt'), TypeError);
  await assert.rejects(removeBlob(folder, 'files/../../outside.txt'), TypeError);
  assert.equal(touched, false);
});

test('story snapshots reject nonportable file references before syncing', () => {
  const project = newProject();
  project.sources.push({ id: 'source-1', updatedAt: '', name: 'outline', path: 'sources/originals/outline.pdf', text: '', extracted: false });
  project.characters.push({ id: 'mira', updatedAt: '', name: 'Mira', role: '', background: '', appearance: '', personality: '', arc: '', relationships: [], imagePaths: ['assets/characters/mira/portrait.png'] });
  const files = projectFiles(project);
  assert.equal(parseProjectFiles(files).characters[0].imagePaths[0], 'assets/characters/mira/portrait.png');
  const imported = { ...files, 'world/characters/mira.json': JSON.stringify({ ...project.characters[0], imagePaths: ['/other-drive/portrait.png'] }) };
  assert.throws(() => parseProjectFiles(imported), TypeError);

  project.sources[0].path = '/Users/someone/outline.pdf';
  assert.throws(() => projectFiles(project), TypeError);
  project.sources[0].path = '';
  project.characters[0].imagePaths = ['../other-drive/portrait.png'];
  assert.throws(() => projectFiles(project), TypeError);
  project.characters[0].imagePaths = [];
  project.books[0].id = '../outside';
  assert.throws(() => projectFiles(project), TypeError);
});
