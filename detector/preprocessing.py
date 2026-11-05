"""DroidDetect consumes raw source, including comments and whitespace.

Do not carry over LLMSniffer's comment stripping: it changes this model's inputs.
"""


def preprocess(code, language):
    return code
