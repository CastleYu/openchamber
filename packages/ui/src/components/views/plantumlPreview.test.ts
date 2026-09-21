import { describe, expect, test } from 'bun:test';

import { fencePlantUmlSource, isPlantUmlFile } from '@/lib/diagramSource';

describe('plantumlPreview', () => {
  test('recognizes PlantUML source extensions', () => {
    expect(isPlantUmlFile('diagram.puml')).toBe(true);
    expect(isPlantUmlFile('diagram.PLANTUML')).toBe(true);
    expect(isPlantUmlFile('diagram.pu')).toBe(true);
    expect(isPlantUmlFile('diagram.uml')).toBe(false);
  });

  test('wraps source in a PlantUML fence without changing source', () => {
    const source = '@startuml\nAlice -> Bob: hello\n@enduml\n';
    expect(fencePlantUmlSource(source)).toBe(`\`\`\`plantuml\n${source}\`\`\``);
  });

  test('chooses a fence longer than any backtick run in source', () => {
    const source = '@startuml\nnote right: ````\n@enduml';
    const fenced = fencePlantUmlSource(source);
    const opening = fenced.split('\n', 1)[0];
    expect(opening).toBe('`````plantuml');
    expect(fenced.endsWith('\n`````')).toBe(true);
    expect(fenced.includes(source)).toBe(true);
  });
});
