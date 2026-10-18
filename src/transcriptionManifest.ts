export type TranscriptionAsset = { name: string; url: string; bytes: number; sha256: string };
export const TRANSCRIPTION_PATH = 'models/Whisper-Tiny-English-Q8';
export const TRANSCRIPTION_ENGINE_PATH = 'engines/Transformers-ASR';
export const TRANSCRIPTION_SOURCE = 'https://huggingface.co/Xenova/whisper-tiny.en/tree/79fb389fc764e7c395bd330e9531d9d32ada7049';
const modelBase = 'https://huggingface.co/Xenova/whisper-tiny.en/resolve/79fb389fc764e7c395bd330e9531d9d32ada7049/';
const engineBase = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';
const license: TranscriptionAsset = { name: 'LICENSE-Apache-2.0.txt', url: 'https://www.apache.org/licenses/LICENSE-2.0.txt', bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' };
const modelFile = (name: string, bytes: number, sha256: string): TranscriptionAsset => ({ name, url: modelBase + name, bytes, sha256 });
export const TRANSCRIPTION_MODEL_ASSETS: readonly TranscriptionAsset[] = [
  license,
  modelFile('README.md', 3213, '2f4ddb95ec9d6c6d5f6a1374fc004f45e91f6d7f450ee479f765b8aca47e8b4d'),
  modelFile('added_tokens.json', 2082, '598c98875c01fe7ebd08ba6779f052f1136de6d36d9e7b99e04b432f78ecb28d'),
  modelFile('config.json', 2202, '37a1073be00d19118c06557896c7c148598f4d8277edc0f5bc07c9f5554839f1'),
  modelFile('generation_config.json', 1590, '132c95ba9db45f4498f2eab3fea7c1d6a174005010f8f6b7d20cfd5e9795996b'),
  modelFile('normalizer.json', 52666, 'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd'),
  modelFile('merges.txt', 456318, '1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5'),
  modelFile('preprocessor_config.json', 339, 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d'),
  modelFile('quant_config.json', 2840, '757dc2d96699ce44e209c63c79ee4d41758a4baff39de9c5bc59ad90de454e81'),
  modelFile('quantize_config.json', 2840, '6cc8120dd11eac1a4fbc463c4729e4e1a6eed5bdb50b55f61c3210396d0ee3dc'),
  modelFile('special_tokens_map.json', 1717, '7da611d517fe29e77335b8d8384e71795fb7b37cbf95bdc3b5252fa7e09dd1f8'),
  modelFile('tokenizer.json', 2128494, 'c6ee8f089220a5b1188f6426456772572671c6141ae007eecb83c6a8349f5deb'),
  modelFile('tokenizer_config.json', 835, 'e082c1ad251541bf277967a703252cddd4bb37a71a43737e03d050c22ec08238'),
  modelFile('vocab.json', 999186, 'f6bd25a65e4e63ca31360e9fb11c7e4f9a391a78385d640acd814092dd6eee4f'),
  modelFile('onnx/encoder_model_quantized.onnx', 10124913, '8cc3c6f8563d1b3fbd2c5af9f64c2bed8b020bc593c402d1ef53b9f08fbf1b90'),
  modelFile('onnx/decoder_model_merged_quantized.onnx', 30727382, 'dbb2e063b7fbc41d9803b9698f93ecb035c50cbb3fb87b56cb131e4a5eb99059'),
];
export const TRANSCRIPTION_ENGINE_ASSETS: readonly TranscriptionAsset[] = [
  license,
  { name: 'transformers.min.js', url: engineBase + 'transformers.min.js', bytes: 888173, sha256: 'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa' },
  { name: 'ort-wasm-simd-threaded.jsep.mjs', url: engineBase + 'ort-wasm-simd-threaded.jsep.mjs', bytes: 44484, sha256: '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9' },
  { name: 'ort-wasm-simd-threaded.jsep.wasm', url: engineBase + 'ort-wasm-simd-threaded.jsep.wasm', bytes: 21596019, sha256: 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39' },
];


const mitLicense: TranscriptionAsset = { name: 'LICENSE-Moonshine.txt', url: 'https://raw.githubusercontent.com/moonshine-ai/moonshine/234f60faa0eb388b01cdf7e60aca232af37aefda/LICENSE', bytes: 14180, sha256: 'fa7d1174dd8af6a7cd280be20b80d10095ed4c19b5b20b61a7715c3ad790dc5f' };
const repoAsset = (repo: string, revision: string, name: string, bytes: number, sha256: string): TranscriptionAsset => ({ name, url: `https://huggingface.co/${repo}/resolve/${revision}/${name}`, bytes, sha256 });
const moonshineTinyAssets: readonly TranscriptionAsset[] = [mitLicense,
  repoAsset('onnx-community/moonshine-tiny-ONNX', 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95', 'config.json', 921, '558e1e02069137c796ace1e50c48d8fe451f04a295929138e6bea885517f0edb'),
  repoAsset('onnx-community/moonshine-tiny-ONNX', 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95', 'generation_config.json', 147, 'f9b3f711b57be7def2e50a8942f64f36ee0a55fad5b84ff93a687b6c5bcc1d44'),
  repoAsset('onnx-community/moonshine-tiny-ONNX', 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95', 'onnx/decoder_model_merged_quantized.onnx', 20243286, 'eed87831c3a6103534aae7d47a5d485025c659a1323901513961c39fe8a1a367'),
  repoAsset('onnx-community/moonshine-tiny-ONNX', 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95', 'onnx/encoder_model_quantized.onnx', 7937661, 'c6fc4b7bc5af75c0591fd157a1f3829b533d18e9769a888fd95a62e470dd4f4a'),
  repoAsset('onnx-community/moonshine-tiny-ONNX', 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95', 'preprocessor_config.json', 128, 'fa43a7017ef85cd1d0fba0d9aae77c8adb16990ae6f11115631f41ec5d8aa679'),
  repoAsset('onnx-community/moonshine-tiny-ONNX', 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95', 'special_tokens_map.json', 3, 'ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356'),
  repoAsset('onnx-community/moonshine-tiny-ONNX', 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95', 'tokenizer.json', 3761754, '7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f'),
  repoAsset('onnx-community/moonshine-tiny-ONNX', 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95', 'tokenizer_config.json', 135735, 'edaee394565d428ea98a663ae7209cdcfeefc5585c42d7a570ff7c986df2cd15'),
];
const moonshineBaseAssets: readonly TranscriptionAsset[] = [mitLicense,
  repoAsset('onnx-community/moonshine-base-ONNX', 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad', 'config.json', 922, 'fab7241d1e9fc6c2370c4c6dfb5da79bb54d67ed9ab6b507ac51d29d2abe01d1'),
  repoAsset('onnx-community/moonshine-base-ONNX', 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad', 'generation_config.json', 147, 'f9b3f711b57be7def2e50a8942f64f36ee0a55fad5b84ff93a687b6c5bcc1d44'),
  repoAsset('onnx-community/moonshine-base-ONNX', 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad', 'onnx/decoder_model_merged_quantized.onnx', 42498870, 'cc9f3cd6698a369c6008b41aa60aa3fb3322e7f03c9bdf19d8e6b7200afca4f3'),
  repoAsset('onnx-community/moonshine-base-ONNX', 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad', 'onnx/encoder_model_quantized.onnx', 20513063, '1dd9ab0a7f987113d30affcba5a068d11c8f90fa0223caa3e491ade431ad9751'),
  repoAsset('onnx-community/moonshine-base-ONNX', 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad', 'preprocessor_config.json', 128, 'fa43a7017ef85cd1d0fba0d9aae77c8adb16990ae6f11115631f41ec5d8aa679'),
  repoAsset('onnx-community/moonshine-base-ONNX', 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad', 'special_tokens_map.json', 3, 'ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356'),
  repoAsset('onnx-community/moonshine-base-ONNX', 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad', 'tokenizer.json', 3761754, '7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f'),
  repoAsset('onnx-community/moonshine-base-ONNX', 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad', 'tokenizer_config.json', 135735, 'edaee394565d428ea98a663ae7209cdcfeefc5585c42d7a570ff7c986df2cd15'),
];
const wav2vecAssets: readonly TranscriptionAsset[] = [license,
  repoAsset('onnx-community/wav2vec2-base-960h-ONNX', '729c1a6730fb549c20a1c73a3d3f96f11020225e', 'config.json', 2157, '15c7cf6378153bdcb33fce27780ab9aae37fd154fbb674cacc3347992055d323'),
  repoAsset('onnx-community/wav2vec2-base-960h-ONNX', '729c1a6730fb549c20a1c73a3d3f96f11020225e', 'onnx/model_quantized.onnx', 95212816, '1d9a366c27b2966625cd5035ac3db8847c53bba617169912bb251b42975a3a22'),
  repoAsset('onnx-community/wav2vec2-base-960h-ONNX', '729c1a6730fb549c20a1c73a3d3f96f11020225e', 'preprocessor_config.json', 215, '8cdfd65ff4115423185a1512bdae100e2e0cd744f5b322417429944aaafd0827'),
  repoAsset('onnx-community/wav2vec2-base-960h-ONNX', '729c1a6730fb549c20a1c73a3d3f96f11020225e', 'special_tokens_map.json', 96, '9046da57c270c8e74d0f38832b4adce269c9d914ef21d2a0925e7772152dd793'),
  repoAsset('onnx-community/wav2vec2-base-960h-ONNX', '729c1a6730fb549c20a1c73a3d3f96f11020225e', 'tokenizer.json', 2187, 'df57f576f5ef16a454ae2776dcc777ffef0bc824113043043b7218c829fc7405'),
  repoAsset('onnx-community/wav2vec2-base-960h-ONNX', '729c1a6730fb549c20a1c73a3d3f96f11020225e', 'tokenizer_config.json', 1178, '6f2b1da40bb8a9838af8639cb672bfa4d9bc98fed7a7cea38452eb3afc30e430'),
  repoAsset('onnx-community/wav2vec2-base-960h-ONNX', '729c1a6730fb549c20a1c73a3d3f96f11020225e', 'vocab.json', 358, '4178db26b3c7570f6a47f14ac6a1c7b32950b8c2800fb097287e53776934f1c5'),
];

export const SHERPA_ARCHIVE_NAME = 'sherpa-onnx-wasm-simd-v1.12.32-en-asr-zipformer.tar.bz2';
export const SHERPA_ENGINE_PATH = 'engines/Sherpa-ONNX-ASR';
export const SHERPA_EXTRACTED_ASSETS: readonly TranscriptionAsset[] = [
  { name: 'sherpa-onnx-asr.js', url: '', bytes: 49519, sha256: 'c71a9817c2dd3ab69fd1967a81260428650890980d11d97cfa8e00d551e34f2b' },
  { name: 'sherpa-onnx-wasm-main-asr.js', url: '', bytes: 93028, sha256: 'b4945e9bee9c1100565dad6887ca22cfbaf209b9b4562206cff601c02860f538' },
  { name: 'sherpa-onnx-wasm-main-asr.wasm', url: '', bytes: 11549006, sha256: 'd152117fd2d251edd617f0a066d53672ecd5a61c38096647f09aed403dc4b0cb' },
  { name: 'sherpa-onnx-wasm-main-asr.data', url: '', bytes: 190951044, sha256: 'b80cd7fc7c709509fadd2a9fdcd33ea2eb4803227871a3848d7cd055d84375bf' },
];
const sherpaAssets: readonly TranscriptionAsset[] = [license, { name: SHERPA_ARCHIVE_NAME, url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.32/${SHERPA_ARCHIVE_NAME}`, bytes: 174731388, sha256: '32e1ecfec964b97026d36ddc13a72bc0f51ff24e2379a46de3d2fc43b7120176' }];
export const TRANSCRIPTION_MODELS = [
  { id: 'whisper', path: TRANSCRIPTION_PATH, label: 'Whisper Tiny English', family: 'Whisper', version: 'Tiny', parametersB: 0.039, quantization: 'Q8', repo: 'Xenova/whisper-tiny.en', revision: '79fb389fc764e7c395bd330e9531d9d32ada7049', license: 'Apache 2.0', licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0', company: 'OpenAI / Xenova', country: 'United States', description: 'Compact English transcription with timed segments.', assets: TRANSCRIPTION_MODEL_ASSETS },
  { id: 'moonshine_tiny', path: 'models/Moonshine-Tiny-Q8', label: 'Moonshine Tiny', family: 'Moonshine', version: 'Tiny', parametersB: 0.027, quantization: 'Q8', repo: 'onnx-community/moonshine-tiny-ONNX', revision: 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95', license: 'MIT', licenseUrl: 'https://huggingface.co/onnx-community/moonshine-tiny-ONNX', company: 'Moonshine AI / ONNX Community', country: 'United States', description: 'Small English speech recognition model.', assets: moonshineTinyAssets },
  { id: 'moonshine_base', path: 'models/Moonshine-Base-Q8', label: 'Moonshine Base', family: 'Moonshine', version: 'Base', parametersB: 0.061, quantization: 'Q8', repo: 'onnx-community/moonshine-base-ONNX', revision: 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad', license: 'MIT', licenseUrl: 'https://huggingface.co/onnx-community/moonshine-base-ONNX', company: 'Moonshine AI / ONNX Community', country: 'United States', description: 'Larger Moonshine model for an accuracy comparison.', assets: moonshineBaseAssets },
  { id: 'sherpa', path: 'models/Sherpa-Zipformer-Streaming', label: 'Sherpa Zipformer Streaming', family: 'Zipformer', version: '2023-06-21', parametersB: 0, quantization: 'INT8', repo: 'k2-fsa/sherpa-onnx', revision: 'v1.12.32', license: 'Apache 2.0', licenseUrl: 'https://github.com/k2-fsa/sherpa-onnx/blob/v1.12.32/LICENSE', company: 'k2-fsa', country: '—', description: 'Live English transcription with partial microphone results.', assets: sherpaAssets },
  { id: 'wav2vec2', path: 'models/Wav2Vec2-Base-960h-Q8', label: 'Wav2Vec2 Base 960h', family: 'Wav2Vec2', version: 'Base 960h', parametersB: 0.095, quantization: 'Q8', repo: 'onnx-community/wav2vec2-base-960h-ONNX', revision: '729c1a6730fb549c20a1c73a3d3f96f11020225e', license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/facebook/wav2vec2-base-960h', company: 'Meta / ONNX Community', country: 'United States', description: 'English CTC transcription using a different model architecture.', assets: wav2vecAssets },
] as const;
export type TranscriptionModelId = typeof TRANSCRIPTION_MODELS[number]['id'];
export type TranscriptionKind = 'engine' | TranscriptionModelId;
export const transcriptionModel = (id: TranscriptionModelId) => TRANSCRIPTION_MODELS.find(model => model.id === id)!;
export const transcriptionModelForPath = (path: string) => TRANSCRIPTION_MODELS.find(model => model.path === path);
export const transcriptionAssets = (kind: TranscriptionKind): readonly TranscriptionAsset[] => kind === 'engine' ? TRANSCRIPTION_ENGINE_ASSETS : transcriptionModel(kind).assets;
export const transcriptionTotal = (kind: TranscriptionKind) => transcriptionAssets(kind).reduce((total, asset) => total + asset.bytes, 0);
