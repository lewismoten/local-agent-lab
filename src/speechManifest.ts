// Pinned Pocket TTS browser bundles. Hashes come from Hugging Face LFS objects or downloaded small files.
export type SpeechModelId = 'english_2026-04' | 'german' | 'spanish' | 'kokoro_q8' | 'chatterbox_q4f16' | 'chatterbox_turbo_q4f16' | 'qwen3_tts_17b_q4' | 'openvoice_v2_q8';
export type SpeechAsset = { name: string; url: string; bytes: number; sha256: string };
export type SpeechModel = { id: SpeechModelId; label: string; language: string; path: string; source: string; licenseUrl: string; assets: readonly SpeechAsset[]; bytes: number; engine?: 'kokoro' | 'chatterbox' | 'qwen' | 'openvoice' };
// The pinned English, German, and Spanish bundle.json files all list these names.
export const POCKET_BUILT_IN_VOICES = ['alba', 'azelma', 'cosette', 'eponine', 'fantine', 'javert', 'jean', 'marius'] as const;
const revision = 'c469236dbc5f68287fa2fbf175b66de3b80123af';
const base = `https://huggingface.co/vlapky/pocket-tts-onnx/resolve/${revision}/onnx/`;
const license: SpeechAsset = { name: 'LICENSE-CC-BY-4.0.txt', url: 'https://creativecommons.org/licenses/by/4.0/legalcode.txt', bytes: 18657, sha256: '9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411' };
const modelCard: SpeechAsset = { name: 'MODEL-CARD.md', url: `https://huggingface.co/vlapky/pocket-tts-onnx/resolve/${revision}/README.md`, bytes: 8057, sha256: '05ed0a614d1b512918aa02062624407040680c9a8e8fd6f437e4b59519f0bbff' };
const kokoroRevision = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const kokoroBase = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${kokoroRevision}/`;
const kokoroLicense: SpeechAsset = { name: 'LICENSE-Apache-2.0.txt', url: 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/LICENSE', bytes: 11357, sha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4' };
const chatterboxRevision = 'd21799bd0354adb85e348b8a0442a8405110a2cf';
const chatterboxBase = `https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX/resolve/${chatterboxRevision}/`;
const chatterboxLicense: SpeechAsset = { name: 'LICENSE-MIT.txt', url: 'https://raw.githubusercontent.com/resemble-ai/chatterbox/5de7a54aa4e5e2baadb0182dde554908b48b85c2/LICENSE', bytes: 1067, sha256: '4248e910a928849fe5815a0f9236e17fa07768d95b9193212752c464b93d6caa' };
const chatterboxClassicRevision = '3cab09af388d3f02bba43443fce88c1f4525ac43';
const chatterboxClassicBase = `https://huggingface.co/onnx-community/chatterbox-ONNX/resolve/${chatterboxClassicRevision}/`;
const qwenRevision = 'ca27d74bc954b73dadab5b71ca265d87fc861a7c';
const qwenBase = `https://huggingface.co/ggml-org/Qwen3-TTS-12Hz-1.7B-Base-GGUF/resolve/${qwenRevision}/`;
const qwenLicense: SpeechAsset = { name: 'LICENSE-Apache-2.0.txt', url: 'https://raw.githubusercontent.com/QwenLM/Qwen3-TTS/022e286b98fbec7e1e916cb940cdf532cd9f488e/LICENSE', bytes: 11343, sha256: 'a44a6081c73ad75f0255bb2bb5cab74ef1829565a895a24e53a4f11290ab7655' };
const openVoiceRevision = '34d010c192c97f763207f488f6057fd07fee42ad';
const openVoiceBase = `https://huggingface.co/TigreGotico/voiceclonnx-openvoice-v2/resolve/${openVoiceRevision}/`;
const openVoiceLicense: SpeechAsset = { name: 'LICENSE-MIT.txt', url: 'https://raw.githubusercontent.com/myshell-ai/OpenVoice/8b715b5b967f90913f0adb4e6b778b929da473cc/LICENSE', bytes: 1057, sha256: 'bb3541f421e6273d3a3e3dd5bdba2bd3b79a3c2eadca65cde9c62c2467903ac0' };
export const SPEECH_MODELS: readonly SpeechModel[] = [
  { id: 'english_2026-04', label: 'Pocket TTS English', language: 'English', path: 'models/Pocket-TTS-english_2026-04', source: 'https://huggingface.co/vlapky/pocket-tts-onnx/tree/c469236dbc5f68287fa2fbf175b66de3b80123af/onnx/english_2026-04', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/legalcode', assets: [license, modelCard,
    { name: 'bundle.json', url: base + 'english_2026-04/bundle.json', bytes: 24381, sha256: 'bab643150f437f37df080a710520ff39ed9ebd9a339f8ebdc739f7eddfc28b3f' },
    { name: 'tokenizer.model', url: base + 'english_2026-04/tokenizer.model', bytes: 59339, sha256: 'd461765ae179566678c93091c5fa6f2984c31bbe990bf1aa62d92c64d91bc3f6' },
    { name: 'bos_before_voice.npy', url: base + 'english_2026-04/bos_before_voice.npy', bytes: 4224, sha256: 'f46edf4f7007b7ba4ea58831f49d003e59e167b4641c44bb3addfe9231a780b1' },
    { name: 'text_conditioner_int8.onnx', url: base + 'english_2026-04/text_conditioner_int8.onnx', bytes: 16388384, sha256: '24c0642bff11a4e1435c004d0c2aa6c68e093fadfa35f0f0dba849ac67f25ac3' },
    { name: 'flow_lm_main_int8.onnx', url: base + 'english_2026-04/flow_lm_main_int8.onnx', bytes: 76341079, sha256: 'f9bd8106b79a0192c1c43399ab938fb24900a95c1c599870d75a884e99000116' },
    { name: 'flow_lm_flow_int8.onnx', url: base + 'english_2026-04/flow_lm_flow_int8.onnx', bytes: 9962530, sha256: '3dd781ee5abee9e195320bf0106bebd6372a852b3b36352524ee78b40554635d' },
    { name: 'mimi_decoder_int8.onnx', url: base + 'english_2026-04/mimi_decoder_int8.onnx', bytes: 22684077, sha256: '3630450a3297a101792a6ac66619ebc70ab916b265e6220c2afaef8b1673f925' },
    { name: 'mimi_encoder_int8.onnx', url: base + 'english_2026-04/mimi_encoder_int8.onnx', bytes: 20779616, sha256: 'abb46f1ad0b83c3840fe38c3652ab0eda7d1d97a63f1953bbbff5d04d8f4c855' },
    { name: 'voices.bin', url: base + 'english_2026-04/voices.bin', bytes: 52401928, sha256: '044364b05514d99f72c63830b0675951137c36f836e1e71bb2546e59b8c6d625' },
  ], bytes: 198672272 },
  { id: 'german', label: 'Pocket TTS German', language: 'German', path: 'models/Pocket-TTS-german', source: 'https://huggingface.co/vlapky/pocket-tts-onnx/tree/c469236dbc5f68287fa2fbf175b66de3b80123af/onnx/german', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/legalcode', assets: [license, modelCard,
    { name: 'bundle.json', url: base + 'german/bundle.json', bytes: 24362, sha256: '7f032e4df0db3a02e24871dfa496e2b7ffa095dd98640bfcf12c04b8671ac60e' },
    { name: 'tokenizer.model', url: base + 'german/tokenizer.model', bytes: 59837, sha256: '389079b9c67cd17ff1c565d53bc695df390b4ca8abf2300947e659585edd9d2a' },
    { name: 'bos_before_voice.npy', url: base + 'german/bos_before_voice.npy', bytes: 4224, sha256: '8c866aec4bcd5f0e6ca788f4b24eacba799b02262905e9f5d6f967409872f8df' },
    { name: 'text_conditioner_int8.onnx', url: base + 'german/text_conditioner_int8.onnx', bytes: 16388384, sha256: 'de27b06fcd3901d50fdd95d669ba7a59e8311e4dba4120635eca3f3a898871b7' },
    { name: 'flow_lm_main_int8.onnx', url: base + 'german/flow_lm_main_int8.onnx', bytes: 76341079, sha256: '3d5e9cd303ecd26fc75b91e2766bce6de3d274d397d3ee9a392f6299366681ef' },
    { name: 'flow_lm_flow_int8.onnx', url: base + 'german/flow_lm_flow_int8.onnx', bytes: 9962530, sha256: '2b0eb8381c49672ac1050c50221db02033b5dc6c346ab45c67bd05344257f06c' },
    { name: 'mimi_decoder_int8.onnx', url: base + 'german/mimi_decoder_int8.onnx', bytes: 22684077, sha256: '3fe868810d66fa0c26bb3ae0d5ee65cae83028c0fe83398bcf3d96478f68083b' },
    { name: 'mimi_encoder_int8.onnx', url: base + 'german/mimi_encoder_int8.onnx', bytes: 20779616, sha256: 'd11af63a34c01eaa967c4de6fd7804e1446c56d29e9bd6dd58ec908979ffa598' },
    { name: 'voices.bin', url: base + 'german/voices.bin', bytes: 52401928, sha256: '092ee9503aec67129993b50dd425100c146dad1bc30c7e5131d7ef551b293e27' },
  ], bytes: 198672751 },
  { id: 'spanish', label: 'Pocket TTS Spanish', language: 'Spanish', path: 'models/Pocket-TTS-spanish', source: 'https://huggingface.co/vlapky/pocket-tts-onnx/tree/c469236dbc5f68287fa2fbf175b66de3b80123af/onnx/spanish', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/legalcode', assets: [license, modelCard,
    { name: 'bundle.json', url: base + 'spanish/bundle.json', bytes: 24365, sha256: 'c9f18b5fc326c2a99f645588b79ef27ef3c9c6c3066f8df73bccb7f7c1f855b3' },
    { name: 'tokenizer.model', url: base + 'spanish/tokenizer.model', bytes: 60895, sha256: 'aac2b96478e3e3068712bd5c45dc196f84b7341ea72587c33a2094957f0c1b0c' },
    { name: 'bos_before_voice.npy', url: base + 'spanish/bos_before_voice.npy', bytes: 4224, sha256: '2c77a716ac206316d6656bdb4cf09e8a2fc9fa7a7f6cde4cceadc3fd7bb1d2a1' },
    { name: 'text_conditioner_int8.onnx', url: base + 'spanish/text_conditioner_int8.onnx', bytes: 16388384, sha256: 'd6b0f7600ded387b6289d2034d937765fb2a9ca63745d83ec98144efc4eea3bd' },
    { name: 'flow_lm_main_int8.onnx', url: base + 'spanish/flow_lm_main_int8.onnx', bytes: 76341079, sha256: '9b020318976e0437bcc78ad0f4a49bf1de6e6e2193c6b0380398038601f9a270' },
    { name: 'flow_lm_flow_int8.onnx', url: base + 'spanish/flow_lm_flow_int8.onnx', bytes: 9962530, sha256: '4cc630a8fc1d28e3b432349e492f5f81696aab88b1067b5282b15427fde19efe' },
    { name: 'mimi_decoder_int8.onnx', url: base + 'spanish/mimi_decoder_int8.onnx', bytes: 22684077, sha256: '309efd11b65c58cd176e554d09241f3e2c9aaabd8cbf74b8f01bdd3ec8f7d8e5' },
    { name: 'mimi_encoder_int8.onnx', url: base + 'spanish/mimi_encoder_int8.onnx', bytes: 20779616, sha256: 'c2d5b57c7acb7c4c0852f4e83d22b794e8a8b12377d0e3f87b69197b7a425afb' },
    { name: 'voices.bin', url: base + 'spanish/voices.bin', bytes: 52401928, sha256: 'c8c213e334ba6b6baeab44ad504ffd13dba4e56533b83dee1524a85069e49d06' },
  ], bytes: 198673812 },
  { id: 'kokoro_q8', label: 'Kokoro Q8', language: 'English', path: 'models/Kokoro-82M-Q8', source: `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/${kokoroRevision}`, licenseUrl: 'https://github.com/hexgrad/kokoro/blob/main/LICENSE', engine: 'kokoro', assets: [kokoroLicense,
    { name: 'MODEL-CARD.md', url: kokoroBase + 'README.md', bytes: 10627, sha256: 'b8fd888b4782f4d4ae85e2f1587cafd727037f4f138f72429ef1bd5908c0e9d8' },
    { name: 'config.json', url: kokoroBase + 'config.json', bytes: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f' },
    { name: 'tokenizer.json', url: kokoroBase + 'tokenizer.json', bytes: 3497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
    { name: 'tokenizer_config.json', url: kokoroBase + 'tokenizer_config.json', bytes: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20' },
    { name: 'model_quantized.onnx', url: kokoroBase + 'onnx/model_quantized.onnx', bytes: 92361116, sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478' },
    { name: 'af_heart.bin', url: kokoroBase + 'voices/af_heart.bin', bytes: 522240, sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b' },
    { name: 'af_bella.bin', url: kokoroBase + 'voices/af_bella.bin', bytes: 522240, sha256: 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b' },
    { name: 'am_michael.bin', url: kokoroBase + 'voices/am_michael.bin', bytes: 522240, sha256: '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1' },
    { name: 'bf_emma.bin', url: kokoroBase + 'voices/bf_emma.bin', bytes: 522240, sha256: '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73' },
  ], bytes: 94475714 },
  { id: 'chatterbox_q4f16', label: 'Chatterbox Q4F16', language: 'English', path: 'models/Chatterbox-Q4F16', source: `https://huggingface.co/onnx-community/chatterbox-ONNX/tree/${chatterboxClassicRevision}`, licenseUrl: chatterboxLicense.url, engine: 'chatterbox', assets: [chatterboxLicense,
    { name: 'MODEL-CARD.md', url: chatterboxClassicBase + 'README.md', bytes: 10681, sha256: '3d1512c5caa3c5f32b68b26b7075b6c2f0f66fbe9328ed2f82668a61e8076211' },
    { name: 'config.json', url: chatterboxClassicBase + 'config.json', bytes: 1097, sha256: 'a7d8518edd1cf6346e4d2be33201747ea4c476718db756f42e6959e4828f4955' },
    { name: 'generation_config.json', url: chatterboxClassicBase + 'generation_config.json', bytes: 93, sha256: '1b6fbb953861089ebe7da64df46eeef570d53f47a44b7cc1b4d543669fc9cd50' },
    { name: 'preprocessor_config.json', url: chatterboxClassicBase + 'preprocessor_config.json', bytes: 130, sha256: '1c320b2eea5f45678d17d891d51c38467775091dbf26a074635ba5e98ede5950' },
    { name: 'tokenizer.json', url: chatterboxClassicBase + 'tokenizer.json', bytes: 28543, sha256: 'ecddf6aaae85e271610a2743409f7e447886957d0b0836687c1eaec5ccac2891' },
    { name: 'tokenizer_config.json', url: chatterboxClassicBase + 'tokenizer_config.json', bytes: 244, sha256: 'b35967f93e30313d05fc9d520721ca9f671aaa5b3edbb03059aed3ff68b4c4c0' },
    { name: 'conditional_decoder.onnx', url: chatterboxClassicBase + 'onnx/conditional_decoder.onnx', bytes: 6350448, sha256: '1656d0d31332bae1854839959a3139300ebb67c178651dfa3f8c5fbfa5351351' },
    { name: 'conditional_decoder.onnx_data', url: chatterboxClassicBase + 'onnx/conditional_decoder.onnx_data', bytes: 533970816, sha256: '51d58345a272747665ec9d5bb61e01835258a940e321a288582ac4c18cf01b5a' },
    { name: 'embed_tokens.onnx', url: chatterboxClassicBase + 'onnx/embed_tokens.onnx', bytes: 13286, sha256: '160722ec14789f616abdb1e31916cbbf9223c03fde0ab546d64ca74fb72e430b' },
    { name: 'embed_tokens.onnx_data', url: chatterboxClassicBase + 'onnx/embed_tokens.onnx_data', bytes: 61640704, sha256: '898c563c3a5ca1b9ea10ce89b0cdcf252b0bb5ab460dfc4eadea003b56e5d2ee' },
    { name: 'language_model_q4f16.onnx', url: chatterboxClassicBase + 'onnx/language_model_q4f16.onnx', bytes: 229388, sha256: '3b78e9235be5e2e2a811e482399155cb30415f6d87c98c21d12bf48843fc928f' },
    { name: 'language_model_q4f16.onnx_data', url: chatterboxClassicBase + 'onnx/language_model_q4f16.onnx_data', bytes: 304737408, sha256: '2480da95471e4cd41a6b1876686e65e8a594c82459f2e5d6fd7592a5bad4e6da' },
    { name: 'speech_encoder.onnx', url: chatterboxClassicBase + 'onnx/speech_encoder.onnx', bytes: 1184608, sha256: '8f1c8a0f89b77bf9cd5dd8f2e034eb2c79dc00fe70d41196b28c257643b00ccb' },
    { name: 'speech_encoder.onnx_data', url: chatterboxClassicBase + 'onnx/speech_encoder.onnx_data', bytes: 591274880, sha256: '04431dcef6325c54b02de2219845888b464bcd1f1ac2f8839c2fecd1ed2ef294' },
  ], bytes: 1499443393 },
  { id: 'chatterbox_turbo_q4f16', label: 'Chatterbox Turbo Q4F16', language: 'English', path: 'models/Chatterbox-Turbo-Q4F16', source: `https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX/tree/${chatterboxRevision}`, licenseUrl: chatterboxLicense.url, engine: 'chatterbox', assets: [chatterboxLicense,
    { name: 'MODEL-CARD.md', url: chatterboxBase + 'README.md', bytes: 11357, sha256: '1e5f4f708ad60475377131e1cf5081108873e3cb424539c4ea6401e8d80303db' },
    { name: 'config.json', url: chatterboxBase + 'config.json', bytes: 1188, sha256: '6b52ed838c3bc347ef519659d82fbd35b9ee805fc7a6da92fc46bc58dfa08770' },
    { name: 'generation_config.json', url: chatterboxBase + 'generation_config.json', bytes: 55, sha256: '91d2e5ff0fd172d5e8ac4818ef8bcd9b9ee4f7e562831edc8cc3b3702e64f923' },
    { name: 'preprocessor_config.json', url: chatterboxBase + 'preprocessor_config.json', bytes: 130, sha256: '1c320b2eea5f45678d17d891d51c38467775091dbf26a074635ba5e98ede5950' },
    { name: 'tokenizer.json', url: chatterboxBase + 'tokenizer.json', bytes: 3562272, sha256: '3f04e34bea22f9144d1a19151154095bc9ce0430bf421304f5797e716288a906' },
    { name: 'tokenizer_config.json', url: chatterboxBase + 'tokenizer_config.json', bytes: 414, sha256: '0d637373c70a54c3c7202c0c12b40ff4f346c329960283f5a88031717d73c66f' },
    { name: 'conditional_decoder_q4f16.onnx', url: chatterboxBase + 'onnx/conditional_decoder_q4f16.onnx', bytes: 2394210, sha256: '17c9f7caef818605df2dc197c2f41682c0bda7fe437b8652dae8366de8b68b7e' },
    { name: 'conditional_decoder_q4f16.onnx_data', url: chatterboxBase + 'onnx/conditional_decoder_q4f16.onnx_data', bytes: 162996136, sha256: '3e53cc7cc05e72957797c620e1bf0c6d6b909df937de4756c6e534d50854ca3e' },
    { name: 'embed_tokens_q4f16.onnx', url: chatterboxBase + 'onnx/embed_tokens_q4f16.onnx', bytes: 2548, sha256: 'e5c9507c89e770e35d68bdd669e4ae44b34272232e84f010f2c97959feae79b3' },
    { name: 'embed_tokens_q4f16.onnx_data', url: chatterboxBase + 'onnx/embed_tokens_q4f16.onnx_data', bytes: 33648688, sha256: '37e96447b5f3ef46f46fb35cc599cfcb95b277e5528cc0c89bab78169da620ef' },
    { name: 'language_model_q4f16.onnx', url: chatterboxBase + 'onnx/language_model_q4f16.onnx', bytes: 276803, sha256: '4c5d83674c52bb71683a1ea1f60e2608b80cda48aafce67e8f8c03162c474ad5' },
    { name: 'language_model_q4f16.onnx_data', url: chatterboxBase + 'onnx/language_model_q4f16.onnx_data', bytes: 183981430, sha256: 'f084f21f977e365e76e622d2958c309ff894537f7b7133ac7fc5ce8fc055d6f9' },
    { name: 'speech_encoder_q4f16.onnx', url: chatterboxBase + 'onnx/speech_encoder_q4f16.onnx', bytes: 1217655, sha256: '004407d26127c1d8e974bd213ecff8dbe67611527ca7a1930e656b80d9c51125' },
    { name: 'speech_encoder_q4f16.onnx_data', url: chatterboxBase + 'onnx/speech_encoder_q4f16.onnx_data', bytes: 177289008, sha256: 'c017ab57887418e0609afdef52b0cbc17f43cb304e78af44300c0292cd2b2fa9' },
  ], bytes: 565382961 },
  { id: 'qwen3_tts_17b_q4', label: 'Qwen3-TTS 1.7B', language: 'Multilingual', path: 'models/Qwen3-TTS-1.7B-Q4', source: `https://huggingface.co/ggml-org/Qwen3-TTS-12Hz-1.7B-Base-GGUF/tree/${qwenRevision}`, licenseUrl: qwenLicense.url, engine: 'qwen', assets: [qwenLicense,
    { name: 'Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf', url: qwenBase + 'Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf', bytes: 1035965280, sha256: '8d18c94acb2addd042f97da63c98be144eafa76d0d9495177eab65130cf85129' },
    { name: 'mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf', url: qwenBase + 'mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf', bytes: 446422912, sha256: '6fd65188839bcd6ecc91b277ad471e22a0edfada4699a0fe82f1165c18cfcce2' },
  ], bytes: 1482399535 },
  { id: 'openvoice_v2_q8', label: 'OpenVoice V2 Q8', language: 'Speech audio', path: 'models/OpenVoice-V2-Q8', source: `https://huggingface.co/TigreGotico/voiceclonnx-openvoice-v2/tree/${openVoiceRevision}`, licenseUrl: openVoiceLicense.url, engine: 'openvoice', assets: [openVoiceLicense,
    { name: 'MODEL-CARD.md', url: openVoiceBase + 'README.md', bytes: 3308, sha256: '88380b6beb8dfdfd53babeeac35abbc7a9c4f01a5ba1f520ac19c6ecce7e2187' },
    { name: 'PROVENANCE.md', url: openVoiceBase + 'PROVENANCE.md', bytes: 2222, sha256: '40237288c29d999248c0896416f2e4187366f6d1b2c33922ac9f3ecfb20771ef' },
    { name: 'tone_ref_encoder_q8.onnx', url: openVoiceBase + 'tone_ref_encoder_q8.onnx', bytes: 2315304, sha256: '8e46097e46a68a2137acf105b58bc67cf686ec0d811c1c45ada28557a608c0e3' },
    { name: 'tone_converter_q8.onnx', url: openVoiceBase + 'tone_converter_q8.onnx', bytes: 40804625, sha256: '54ea73764c46cdbb74af2124e30cce42007045f1f5a60bd7520472f155eb6f4c' },
  ], bytes: 43126516 },
];
export const speechModel = (id: SpeechModelId) => SPEECH_MODELS.find(model => model.id === id)!;
export const speechModelForPath = (path: string) => SPEECH_MODELS.find(model => model.path === path) ?? null;

const pocketSource = 'https://raw.githubusercontent.com/vlapky/pocket-tts-js/7d7a27423b0845eb0425c81a8aa5ed3f3d973eef/';
const ortSource = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/';
export const SPEECH_ENGINE_PATH = 'engines/Pocket-TTS';
export const SPEECH_ENGINE_ASSETS: readonly SpeechAsset[] = [
  { name: 'LICENSE-Pocket-TTS-JS.txt', url: pocketSource + 'LICENSE', bytes: 1815, sha256: '2975f18f69d36cdd2bcee921c5ca53268dbfc8bcf381e13ef63e3136552fd32e' },
  { name: 'LICENSE-ONNX-Runtime.txt', url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.20.0/LICENSE', bytes: 1073, sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c' },
  { name: 'index.js', url: pocketSource + 'src/index.js', bytes: 9838, sha256: 'dd1be8dff1355cd1eba705b19d784831fce593ab4e7c843c980c7b865451060b' },
  { name: 'worker.js', url: pocketSource + 'src/worker.js', bytes: 26602, sha256: '0e2d18c0f309c42099c3a56c0c54e3cf31605bee457f62433b0644776dc606dc' },
  { name: 'tokenizer.js', url: pocketSource + 'src/tokenizer.js', bytes: 7190, sha256: '70788cc36841a7be1c08f9e56b280552826a753a854b354a44fb399c6df49651' },
  { name: 'binary.js', url: pocketSource + 'src/binary.js', bytes: 3350, sha256: 'f6b38f71380ce450861f6710df42c7d80e9f751df888f1cafbd18beb071b016a' },
  { name: 'ort.min.mjs', url: ortSource + 'ort.min.mjs', bytes: 446164, sha256: '139580c307255a1db2a068de5a03b1f9a954174695ac07754916c5fbb5c3f4ed' },
  { name: 'ort-wasm-simd-threaded.mjs', url: ortSource + 'ort-wasm-simd-threaded.mjs', bytes: 24618, sha256: 'b58de73c7b47b86290578489c6b5b16ade5d237cd5f340f0776a219bb833bd04' },
  { name: 'ort-wasm-simd-threaded.wasm', url: ortSource + 'ort-wasm-simd-threaded.wasm', bytes: 11241642, sha256: '704f51767fe3e11443aac6b5509c8654688e4cea3d988f96a069390b6eccbabc' },
];
export const KOKORO_ENGINE_ASSETS: readonly SpeechAsset[] = [
  kokoroLicense,
  { name: 'LICENSE-Transformers-Apache-2.0.txt', url: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/LICENSE', bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
  { name: 'LICENSE-Phonemizer-Apache-2.0.txt', url: 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/LICENSE', bytes: 11357, sha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4' },
  { name: 'LICENSE-ONNX-Runtime-MIT.txt', url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.22.0/LICENSE', bytes: 1073, sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c' },
  { name: 'kokoro.web.js', url: 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js', bytes: 2135146, sha256: '6067712fe4c43cdb36c762f860a5ab8d96ea1d9c8882466438eb9f3d0d20be8f' },
  { name: 'ort-wasm-simd-threaded.jsep.mjs', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/ort-wasm-simd-threaded.jsep.mjs', bytes: 44484, sha256: '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9' },
  { name: 'ort-wasm-simd-threaded.jsep.wasm', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/ort-wasm-simd-threaded.jsep.wasm', bytes: 21596019, sha256: 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39' },
];
export const KOKORO_BUILT_IN_VOICES = ['af_heart', 'af_bella', 'am_michael', 'bf_emma'] as const;
export const CHATTERBOX_ENGINE_ASSETS: readonly SpeechAsset[] = [
  { name: 'LICENSE-Transformers.txt', url: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0-next.2/LICENSE', bytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
  { name: 'LICENSE-ONNX.txt', url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/LICENSE', bytes: 1073, sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c' },
  { name: 'transformers.web.js', url: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0-next.2/dist/transformers.web.js', bytes: 960134, sha256: 'd0d3f3d9f28aa92d3ddf626c7c234699331c71de9fcc099aa74cdda92a40f133' },
  { name: 'ort.webgpu.bundle.min.mjs', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.0-dev.20260209-a3749f1353/dist/ort.webgpu.bundle.min.mjs', bytes: 113974, sha256: 'b55ed2653d43785963185032c37dd356ef695cc1b908ade680e2f865030c0ff7' },
  { name: 'ort-wasm-simd-threaded.asyncify.wasm', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.0-dev.20260209-a3749f1353/dist/ort-wasm-simd-threaded.asyncify.wasm', bytes: 27200494, sha256: 'a0a8899e2a218bffc93a684a104a883648569accc3cd1f2bc7c506c6835a968b' },
];
const qwenBridgeBase = 'https://cdn.jsdelivr.net/gh/leehack/llama-web-bridge-assets@v0.1.65/';
export const QWEN_TTS_ENGINE_ASSETS: readonly SpeechAsset[] = [
  { name: 'LICENSE-Bridge-MIT.txt', url: 'https://raw.githubusercontent.com/leehack/llama-web-bridge/d1c1b9aac0e88b5748ea436e0bc81a0ef6c54876/LICENSE', bytes: 1065, sha256: '52a79b73bf86ee8794bd8eab8179761e8f4f8d16e7f1d77168c67629c46163c5' },
  { name: 'llama_webgpu_bridge.js', url: qwenBridgeBase + 'llama_webgpu_bridge.js', bytes: 293959, sha256: '78034e57c432600dabae0833714547844aee520b91cfa203d42c7774d3c63c87' },
  { name: 'llama_webgpu_core_mem64.js', url: qwenBridgeBase + 'llama_webgpu_core_mem64.js', bytes: 143013, sha256: '12c855741cd4a716402d359be971ac3a825cabeb1579af2be2ab7f68524929a8' },
  { name: 'llama_webgpu_core_mem64.wasm', url: qwenBridgeBase + 'llama_webgpu_core_mem64.wasm', bytes: 10461625, sha256: 'de4e520fe41210ee0978d51a64047ecf0141836bc23be84c6ac58d116143465b' },
];
export const OPENVOICE_ENGINE_ASSETS: readonly SpeechAsset[] = [
  CHATTERBOX_ENGINE_ASSETS[1],
  { name: 'ort.webgpu.min.mjs', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.0-dev.20260209-a3749f1353/dist/ort.webgpu.min.mjs', bytes: 67147, sha256: '694838c21da273d5c7ccbc9f86573ba6444fcd1bc610c6991b0f70655aaa2df8' },
  { name: 'ort-wasm-simd-threaded.jsep.mjs', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.0-dev.20260209-a3749f1353/dist/ort-wasm-simd-threaded.jsep.mjs', bytes: 46595, sha256: '1a9d4f18573709d8c4c3a8c8ca54996330324a9b28c7eed8a9b0b01dffc9a201' },
  { name: 'ort-wasm-simd-threaded.jsep.wasm', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.0-dev.20260209-a3749f1353/dist/ort-wasm-simd-threaded.jsep.wasm', bytes: 24951864, sha256: '74910ed2c59325a8282cc7a7b542b5f102a5e30447483e64bed1915fe6f9267f' },
];
