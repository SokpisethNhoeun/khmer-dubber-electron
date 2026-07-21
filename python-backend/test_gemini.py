import asyncio
from google import genai
from google.genai import types

def test():
    client = genai.Client()
    response_schema_subtitles = types.Schema(
        type=types.Type.ARRAY,
        items=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "id": types.Schema(type=types.Type.INTEGER),
                "text": types.Schema(type=types.Type.STRING),
            },
            required=["id", "text"],
        )
    )
    
    prompt = "Translate this to Khmer: [{'id': 1, 'chinese_text': '你好'}]"
    
    response = client.models.generate_content(
        model='gemini-3.1-flash-lite',
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=response_schema_subtitles
        )
    )
    print("RESPONSE TEXT:", repr(response.text))

test()
