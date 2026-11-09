WhisperX 3.8.6 alignment.py and schema.py, BSD-2-Clause.
Source: https://github.com/m-bain/whisperX/tree/v3.8.6/whisperx
Modifications: local imports, standard logging, sentence spans preserve input lyric windows.
Only CTC alignment is retained. WhisperX ASR, VAD, CLI and NLTK loading are not bundled.
Review this small vendored boundary when updating alignment models or torch.
