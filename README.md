# mcp-mochi

Model Context Protocol (MCP) server for [Mochi](https://mochi.cards) flashcards. This is a fork of [fredrikalindh/mcp-mochi](https://github.com/fredrikalindh/mcp-mochi) v2.6.0 with full Mochi API coverage (19 tools), faithful response schemas and automatic retry on Mochi's per-account concurrency limiter.

## Features

- Create, update, archive and delete flashcards
- Create cards from templates with automatic field name-to-ID mapping
- Fetch a single flashcard or deck by ID
- Full deck CRUD (create, get, update, archive, delete)
- Create new templates
- Add or remove attachments (images, audio) on any card
- Get cards due for review on a given date
- List flashcards, decks and templates
- Automatic retry on Mochi's per-account concurrency limiter (HTTP 429)

## Usage with Claude Desktop

Add the following to your `claude_desktop_config.json`. Your `MOCHI_API_KEY` is in Mochi under **Settings → Account → Subscription → API Keys**.

### NPX (recommended)

```json
{
  "mcpServers": {
    "mochi": {
      "command": "npx",
      "args": ["-y", "@k-and/mcp-mochi"],
      "env": {
        "MOCHI_API_KEY": "<YOUR_TOKEN>"
      }
    }
  }
}
```

### Local Development

```json
{
  "mcpServers": {
    "mochi": {
      "command": "node",
      "args": ["/path/to/mcp-mochi/dist/index.js"],
      "env": {
        "MOCHI_API_KEY": "<YOUR_TOKEN>"
      }
    }
  }
}
```

## Local Development Setup

1. Clone and install dependencies:
   ```bash
   git clone https://github.com/k-and/mcp-mochi.git
   cd mcp-mochi
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Test with MCP Inspector:
   ```bash
   MOCHI_API_KEY=<YOUR_TOKEN> npx @modelcontextprotocol/inspector node dist/index.js
   ```

## Available Tools

### Flashcards

| Tool | Description |
|------|-------------|
| `create_flashcard` | Create a new flashcard in Mochi |
| `create_card_from_template` | Create a flashcard using a template with field names (auto-maps to IDs) |
| `get_flashcard` | Fetch a single flashcard by ID |
| `list_flashcards` | List flashcards, optionally filtered by deck |
| `update_flashcard` | Update a flashcard's content, deck, template, fields, position or trash state |
| `archive_flashcard` | Archive or unarchive a flashcard |
| `delete_flashcard` | Permanently delete a flashcard and its attachments |
| `get_due_cards` | Get flashcards due for review on a given date |

### Decks

| Tool | Description |
|------|-------------|
| `create_deck` | Create a new deck, optionally nested under a parent |
| `get_deck` | Fetch a single deck by ID |
| `list_decks` | List all decks |
| `update_deck` | Update a deck's name, parent, sort order, archive or trash state, or display options |
| `archive_deck` | Archive or unarchive a deck |
| `delete_deck` | Permanently delete a deck (contained cards and child decks are not cascaded) |

### Templates

| Tool | Description |
|------|-------------|
| `create_template` | Create a new template for cards |
| `get_template` | Get a single template by ID |
| `list_templates` | List all templates with their field definitions |

### Attachments

| Tool | Description |
|------|-------------|
| `add_attachment` | Attach a file (image, audio, etc.) to an existing card |
| `delete_attachment` | Remove an attachment from a card by filename |

## Resources

| URI | Description |
|-----|-------------|
| `mochi://decks` | List of all decks |
| `mochi://templates` | List of all templates |

## Prompts

| Prompt | Description |
|--------|-------------|
| `write-flashcard` | Generates a well-structured flashcard following best practices (atomic questions, cloze deletions, etc.) |

## Examples

### Create a simple flashcard

```json
{
  "tool": "create_flashcard",
  "params": {
    "content": "What is MCP?\n---\nModel Context Protocol, a protocol for providing context to LLMs",
    "deckId": "<DECK_ID>"
  }
}
```

### Create a card from template

```json
{
  "tool": "create_card_from_template",
  "params": {
    "templateId": "<TEMPLATE_ID>",
    "deckId": "<DECK_ID>",
    "fields": {
      "Front": "What is the capital of France?",
      "Back": "Paris"
    }
  }
}
```

### Get today's due cards

```json
{
  "tool": "get_due_cards",
  "params": {}
}
```

### Create a deck

```json
{
  "tool": "create_deck",
  "params": {
    "name": "Linear Algebra",
    "parentId": "<PARENT_DECK_ID>"
  }
}
```
