import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const esmConfig = {
  input: './index.js',
  output: [
    {
      file: 'dist/index.js',
      format: 'esm'
    },
  ],
  external: [
    ...Object.keys(require('./package.json').dependencies || {}),
  ],
  plugins: [
    nodeResolve({
      exportConditions: ['node'],
    }),
    commonjs({
      include: 'node_modules/**',
      transformMixedEsModules: true
    }),
  ]
};

const cjsConfig = {
  input: './index.js',
  output: [
    {
      file: 'dist/index.cjs',
      format: 'cjs',
    },
  ],
  plugins: [
    nodeResolve({
      exportConditions: ['node'],
    }),
    commonjs(),
  ]
};

export default [esmConfig, cjsConfig];