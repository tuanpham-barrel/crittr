import { createRequire } from 'node:module';
import log from '@dynamicabot/signales';
import path from 'path';
import url from 'url';
import { Crittr } from './lib/classes/Crittr.class';
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const NODE_ENV = process.env.NODE_ENV || 'production';

let IS_NPM_PACKAGE = false;
try {
    const require = createRequire(import.meta.url);
    IS_NPM_PACKAGE = !!require.resolve('crittr');
} catch (e) {}

const pathToCrittr = NODE_ENV === 'development' && !IS_NPM_PACKAGE ? 'lib' : 'lib'; // Only keep for later browser support?

/**
 *
 * @param options
 * @returns {Promise<[<string>, <string>]>}
 */
export default async options => {
    log.time('Crittr Run');

    let crittr;
    let resultObj = { critical: null, rest: null };

    crittr = new Crittr(options);

    resultObj = await crittr.run();

    log.timeEnd('Crittr Run');
    return resultObj;
};
