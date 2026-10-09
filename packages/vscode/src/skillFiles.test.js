import './opencodeConfigTestHome';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as oc1 from './opencodeConfig';
import * as oc2 from './opencodeConfigV2';

for (const [name, api] of [['OC1', oc1], ['OC2', oc2]]) {
  describe(name + ' Skill supporting files', () => {
    let home;
    let skill;
    let other;
    beforeEach(() => {
      home = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-skill-files-'));
      skill = path.join(home, 'skill');
      other = path.join(home, 'outside');
      fs.mkdirSync(skill);
      fs.mkdirSync(other);
      fs.writeFileSync(path.join(other, 'keep.txt'), 'original');
    });
    afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

    test('nested write/read/delete preserves root and missing reads', () => {
      expect(api.readSkillSupportingFile(skill, 'missing.txt')).toBeNull();
      api.deleteSkillSupportingFile(skill, 'missing.txt');
      api.writeSkillSupportingFile(skill, 'notes/deep/example.txt', 'hello');
      expect(api.readSkillSupportingFile(skill, 'notes/deep/example.txt')).toBe('hello');
      api.deleteSkillSupportingFile(skill + path.sep, 'notes/deep/example.txt');
      expect(fs.existsSync(path.join(skill, 'notes'))).toBe(false);
      expect(fs.existsSync(skill)).toBe(true);
    });

    for (const invalid of ['../outside/keep.txt', '..\\outside\\keep.txt', '../new.txt', '', '.', 'notes/..', '/tmp/escape', 'C:\\escape.txt', '\\\\host\\share\\escape.txt', 'keep.txt:stream', 'bad\0path']) {
      test('rejects path ' + JSON.stringify(invalid), () => {
        expect(() => api.readSkillSupportingFile(skill, invalid)).toThrow();
        expect(() => api.writeSkillSupportingFile(skill, invalid, 'bad')).toThrow();
        expect(() => api.deleteSkillSupportingFile(skill, invalid)).toThrow();
        expect(fs.readFileSync(path.join(other, 'keep.txt'), 'utf8')).toBe('original');
        expect(fs.existsSync(path.join(home, 'new.txt'))).toBe(false);
        expect(fs.readdirSync(skill)).toEqual([]);
      });
    }

    test('rejects external junction reads, writes, deletes and missing children', () => {
      fs.symlinkSync(other, path.join(skill, 'link'), 'junction');
      for (const file of ['link/keep.txt', 'link/new/deep.txt']) {
        expect(() => api.readSkillSupportingFile(skill, file)).toThrow();
        expect(() => api.writeSkillSupportingFile(skill, file, 'bad')).toThrow();
        expect(() => api.deleteSkillSupportingFile(skill, file)).toThrow();
      }
      expect(fs.readFileSync(path.join(other, 'keep.txt'), 'utf8')).toBe('original');
      expect(fs.existsSync(path.join(other, 'new'))).toBe(false);
    });

    test('rejects dangling junction without creating its target', () => {
      const missing = path.join(home, 'missing');
      fs.symlinkSync(missing, path.join(skill, 'link'), 'junction');
      expect(() => api.readSkillSupportingFile(skill, 'link/file.txt')).toThrow();
      expect(() => api.writeSkillSupportingFile(skill, 'link/file.txt', 'bad')).toThrow();
      expect(() => api.deleteSkillSupportingFile(skill, 'link/file.txt')).toThrow();
      expect(fs.existsSync(missing)).toBe(false);
    });

    test('allows junctions to directories inside the Skill', () => {
      const target = path.join(skill, 'local');
      fs.mkdirSync(target);
      fs.symlinkSync(target, path.join(skill, 'alias'), 'junction');
      api.writeSkillSupportingFile(skill, 'alias/keep.txt', 'hello');
      expect(api.readSkillSupportingFile(skill, 'alias/keep.txt')).toBe('hello');
      expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('hello');
      api.deleteSkillSupportingFile(skill, 'alias/keep.txt');
      expect(fs.existsSync(path.join(target, 'keep.txt'))).toBe(false);
      expect(fs.existsSync(skill)).toBe(true);
    });
  });
}
