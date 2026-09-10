/*
 * The JSX half of the scoping scheme: every host element of a component file gets
 * `data-ws="<component>"`, and nothing else does.
 *
 * The test is worth having separately from the stylesheet half because both
 * exclusions are silent if they break. Stamping a *component* usage
 * (`<Avatar class="row" />`) would hand the parent's styles into the child;
 * stamping a file outside the components directory would scope tweb's own Solid
 * markup and change how it renders. Neither raises anything at build time.
 */
import {transformAsync} from '@babel/core';
import {describe, expect, it} from 'vitest';
import scopeJsx from './babel-plugin-scope-jsx.mjs';

const COMPONENTS = '/repo/astro/src/components';

const compile = (code, filename) => transformAsync(code, {
  filename,
  babelrc: false,
  configFile: false,
  ast: false,
  plugins: [scopeJsx({componentsDir: COMPONENTS})],
  parserOpts: {plugins: ['jsx', 'typescript']}
});

describe('scopeJsx', () => {
  it('stamps host elements with the component name', async() => {
    const {code} = await compile(
      'export function A() { return <div class="x"><span>hi</span><input value="1" /></div>; }',
      `${COMPONENTS}/ChatAdminMembers.tsx`
    );

    expect(code).toContain('data-ws="chat-admin-members"');
    expect(code.match(/data-ws=/g)).toHaveLength(3);
  });

  it('leaves component usages alone', async() => {
    const {code} = await compile(
      'export function A() { return <Avatar peerId={1}><Sticker size={2} /></Avatar>; }',
      `${COMPONENTS}/Chat.tsx`
    );

    expect(code).not.toContain('data-ws');
    expect(code).toContain('<Avatar peerId={1}>');
    expect(code).toContain('<Sticker size={2} />');
  });

  it('treats a dotted JSX name as a component, not a host element', async() => {
    const {code} = await compile(
      'export function A() { return <Foo.Bar />; }',
      `${COMPONENTS}/Chat.tsx`
    );

    expect(code).not.toContain('data-ws');
  });

  it('does not touch files outside the components directory', async() => {
    const {code} = await compile('export function A() { return <div class="x" />; }', '/repo/src/components/chat/input.tsx');

    // Babel re-prints the code, so compare the semantics rather than the layout.
    expect(code).not.toContain('data-ws');
    expect(code).toContain('<div class="x" />');
  });

  it('does not stamp the same element twice', async() => {
    const {code} = await compile(
      'export function A() { return <div data-ws="chat" />; }',
      `${COMPONENTS}/Chat.tsx`
    );

    expect(code.match(/data-ws=/g)).toHaveLength(1);
  });

  it('stamps children of a fragment', async() => {
    const {code} = await compile(
      'export function A() { return <><b>a</b><i>b</i></>; }',
      `${COMPONENTS}/TopicIcon.tsx`
    );

    expect(code.match(/data-ws="topic-icon"/g)).toHaveLength(2);
  });
});
