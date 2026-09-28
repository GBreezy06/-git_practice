# LLM Temperature Playground

A one-page web app for learning what the **temperature** setting does in a large language model.
Type a prompt, move one slider, send the request to OpenAI with your own API key, and compare
what comes back.

It also shows you the API itself: the exact JSON your browser sends, the raw JSON OpenAI
returns, and where in that JSON the reply lives.

## Run it

There's nothing to install and no build step.

1. Get the files: clone this repo, or on GitHub choose **Code → Download ZIP** and unzip it.
2. Open `temperature-playground/index.html` in your browser (double-clicking it usually works).
3. Paste your OpenAI API key into step 1. You can create one at
   <https://platform.openai.com/api-keys>. The API is billed separately from a ChatGPT
   subscription, so your account needs a little credit.
4. Type a prompt, pick a temperature, and press **Send to OpenAI** (or Ctrl/⌘ + Enter).

If your browser won't run it from a double-click, serve the folder instead:

```sh
cd temperature-playground
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Things to try

1. **Temperature 0, three sends.** With "The sky is", the replies should be (almost) identical.
2. **Temperature 1, three sends.** Similar ideas, different wording.
3. **Temperature 1.8.** Watch the reply drift into nonsense.
4. **Open-ended vs. factual prompts.** "Invent a name for a coffee shop" varies far more than
   "What is 17 × 23?". Temperature matters most when many answers are plausible.
5. **Break it on purpose.** Use a wrong key, or pick **Other…**, type `gpt-5-mini` (a reasoning
   model that only accepts the default temperature of 1), send at 0.5, and read the error JSON.

The **Compare your runs** panel keeps your last 20 replies next to their temperatures, so you
can see the differences side by side.

## What happens when you press Send

Your browser sends one HTTPS request:

```http
POST https://api.openai.com/v1/chat/completions
Content-Type: application/json
Authorization: Bearer <your API key>

{
  "model": "gpt-4.1-mini",
  "messages": [{ "role": "user", "content": "The sky is" }],
  "temperature": 0.7,
  "max_completion_tokens": 300
}
```

- `messages` is the conversation so far. Here it's a single user message: your prompt.
- `temperature` is the slider, from 0 to 2. OpenAI's default is 1.
- `max_completion_tokens` caps the length of the reply, so high temperatures can't ramble on
  (and run up your bill). Clear the box to leave it out of the request.

OpenAI answers with JSON, and the reply text is at `choices[0].message.content`:

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "model": "gpt-4.1-mini-2025-04-14",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "The sky is blue on a clear day." },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 11, "completion_tokens": 9, "total_tokens": 20 }
}
```

Real responses have a few more fields, and the page shows all of them. `finish_reason` is
`"stop"` when the model finished on its own, or `"length"` when it hit your max reply length.

The page also gives you the same request as a `curl` command, so you can send it from a
terminal yourself.

## About your API key

- **Where it's stored:** only in your browser's `localStorage`, under the name
  `temperature-playground.openai-api-key`. It's never in the code or in this repo.
- **Where it's sent:** only to `https://api.openai.com`, in the `Authorization` header. There's
  no server, no analytics and no third-party code, and the page's Content-Security-Policy only
  lets it connect to `api.openai.com`.
- **What to watch out for:** `localStorage` isn't encrypted, so anyone who can use your browser
  profile can read the key. Press **Forget** when you're done on a shared computer. It's also
  worth using a separate project key with a low monthly budget, set in your OpenAI dashboard.
- **Never commit a key to Git.** If one leaks, delete it at <https://platform.openai.com/api-keys>.

## Cost

Every Send is a real, billed API request. With the default model and a 300-token limit, a
request costs a fraction of a cent. See OpenAI's pricing page for current rates.

## Models

The dropdown lists small, low-cost models that accept any temperature from 0 to 2. Choose
**Other…** to type any model name. Many reasoning models (like `gpt-5-mini` and the o-series)
don't accept a custom temperature, and the page tells you when that happens.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page layout and all of its text. |
| `styles.css` | Colors, spacing, and the blue-to-red temperature slider. |
| `app.js` | Builds the request, calls OpenAI (see `send()`), and shows the result. |
