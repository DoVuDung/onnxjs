// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.
import {expect} from 'chai';

import {Attribute} from '../../../../lib/attribute';
import {Backend, InferenceHandler, SessionHandler} from '../../../../lib/backend';
import {WebGLBackend} from '../../../../lib/backends/backend-webgl';
import {WebGLInferenceHandler} from '../../../../lib/backends/webgl/inference-handler';
import {WebGLDepthToSpace} from '../../../../lib/backends/webgl/ops/depth-to-space';
import {Profiler} from '../../../../lib/instrument';
import {Tensor} from '../../../../lib/tensor';
import {ShapeUtil} from '../../../../lib/util';

import {createAscendingArray} from './test_utils';
import {createTextureFromArray, generateArrayForUnpackedTexture} from './test_utils';

let backend: Backend|undefined;
let sessionhandler: SessionHandler|undefined;
let inferenceHandler: InferenceHandler|undefined;

describe('#UnitTest# - unpacked WebGLDepthToSpace - Tensor WebGLDepthToSpace', () => {
  before('Initialize Context', async () => {
    const profiler = Profiler.create();
    backend = await Backend('webgl');
    // Explicitly set to true to trigger packed version
    (backend as WebGLBackend).pack = false;
    sessionhandler = backend.createSessionHandler({profiler});
    inferenceHandler = sessionhandler.createInferenceHandler();
  });

  // Set it back to false, apparently this state is sticky throughout all the tests running in same browser session..
  after('Resetting Context', () => {
    (backend as WebGLBackend).pack = false;
  });

  const testDataSet = getTestData();
  for (let k = 0; k < testDataSet.length; ++k) {
    const testData = testDataSet[k];
    describe(`Test concat ${JSON.stringify(testData)}`, () => {});
    it(`Test depth to space `, () => {
      const webglInferenceHandler = inferenceHandler as WebGLInferenceHandler;

      // TODO support WebGl 1.0
      if (webglInferenceHandler.session.textureManager.glContext.version === 1) {
        console.log('Running depth to space with webgl1 is not supported. Skipping.');
        return;
      }

      const op = new WebGLDepthToSpace();
      const attributes = new Attribute(undefined);
      const blocksize = testData.blocksize;
      attributes.set('blocksize', 'int', blocksize);

      op.initialize(attributes);
      const elementCount = testData.elementCount;
      const inputTensorShape = testData.inputShape;
      const inputTextureShape = testData.inputTextureShape;

      // create input data and tensor. The input data will be used to verify if the output tensor contains the
      // same value but possibly different order depending on our packing algorithm.
      const inputData = testData.rawInput ? testData.rawInput : createAscendingArray(elementCount);
      const inputTensorA = new Tensor(inputTensorShape, 'float32', undefined, undefined, inputData);

      // manually creat packed texture from inputTensor, and insert in cache
      const gl = webglInferenceHandler.session.textureManager.glContext.gl;
      webglInferenceHandler.session.textureManager.glContext.checkError();
      const webglTextureA = createTextureFromArray(
          webglInferenceHandler.session.textureManager.glContext,
          generateArrayForUnpackedTexture(testData.rawInput ? testData.rawInput : inputData), gl.RGBA,
          inputTextureShape[0], inputTextureShape[1]);

      webglInferenceHandler.session.textureManager.glContext.checkError();
      const textureDataA = {
        width: inputTextureShape[0],
        height: inputTextureShape[1],
        channels: 1 as const,
        isPacked: false,
        shape: inputTextureShape,
        strides: ShapeUtil.computeStrides(inputTextureShape),
        unpackedShape: inputTensorShape,
        tensor: inputTensorA,
        texture: webglTextureA!
      };

      webglInferenceHandler.setTextureData(inputTensorA.dataId, textureDataA);

      // compile shader code
      const programInfo = op.createProgramInfo(inferenceHandler! as WebGLInferenceHandler, [inputTensorA]);

      const artifact = webglInferenceHandler.session.programManager.build(programInfo);
      webglInferenceHandler.session.programManager.setArtifact(op, artifact);

      // run kernal and get output
      const runData = op.createRunData(webglInferenceHandler, artifact.programInfo, [inputTensorA]);
      webglInferenceHandler.session.programManager.run(artifact, runData);
      const result = runData.outputTextureData.tensor.data;

      webglInferenceHandler.session.textureManager.glContext.checkError();
      // verify result.
      const expectedOutput = testData.expectedOutput;
      expect(result).to.not.equal(null);

      expect(result).to.have.lengthOf(elementCount);
      expect(result).to.deep.equal(expectedOutput);
    });
  }
});
interface TestData {
  elementCount: number;
  blocksize: number;
  inputShape: number[];
  outputShape: number[];
  inputTextureShape: number[];
  outputTextureShape: number[];
  expectedOutput: Float32Array;
  // If empty, the test will use auto-generated data.
  rawInput?: Float32Array;
  mode?: string;
}
function getTestData(): TestData[] {
  return [
    {
      elementCount: 8,
      blocksize: 2,
      inputShape: [1, 8, 1, 1],
      outputShape: [1, 2, 2, 2],
      inputTextureShape: [8, 1],
      outputTextureShape: [4, 2],
      rawInput: new Float32Array([0., 9., 18., 27., 36., 45., 54., 63.]),
      expectedOutput: new Float32Array([0., 18., 36., 54., 9., 27., 45., 63.]),
    },
    // {
    //   elementCount: 16,
    //   blocksize: 2,
    //   inputShape: [1, 8, 2, 1],
    //   outputShape: [1, 2, 4, 2],
    //   inputTextureShape: [16, 1],
    //   outputTextureShape: [8, 2],
    //   rawInput: new Float32Array([0., 1., 9., 10, 18., 19, 27., 28., 36., 37., 45., 46., 54., 55., 63., 64.]),
    //   expectedOutput: new
    //   Float32Array([0., 18., 1., 19., 36., 54., 37., 55., 9., 27., 10., 28., 45., 63., 46., 64.]),
    // },

    // {
    //   elementCount: 48,
    //   blocksize: 2,
    //   inputShape: [1, 8, 2, 3],
    //   outputShape: [1, 2, 4, 6],
    //   inputTextureShape: [16, 3],
    //   outputTextureShape: [8, 6],
    //   rawInput: new Float32Array([
    //     0.,  1.,  2.,  3.,  4.,  5.,  9.,  10., 11., 12., 13., 14., 18., 19., 20., 21.,
    //     22., 23., 27., 28., 29., 30., 31., 32., 36., 37., 38., 39., 40., 41., 45., 46.,
    //     47., 48., 49., 50., 54., 55., 56., 57., 58., 59., 63., 64., 65., 66., 67., 68.
    //   ]),
    //   expectedOutput: new Float32Array([
    //     0.,  18., 1.,  19., 2.,  20., 36., 54., 37., 55., 38., 56., 3.,  21., 4.,  22.,
    //     5.,  23., 39., 57., 40., 58., 41., 59., 9.,  27., 10., 28., 11., 29., 45., 63.,
    //     46., 64., 47., 65., 12., 30., 13., 31., 14., 32., 48., 66., 49., 67., 50., 68.
    //   ]),
    // },
  ];
}