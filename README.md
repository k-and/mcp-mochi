# Mochi MCP Server

This MCP server provides integration with the Mochi flashcard system, allowing you to manage your flashcards through the Model Context Protocol.

## Features

- Create, update, and delete flashcards
- Create cards from templates with automatic field name-to-ID mapping
- Add attachments (images, audio) to cards
- Get cards due for review
- List flashcards, decks, and templates

## Usage with Claude Desktop

Add the following to your `claude_desktop_config.json`:

### NPX (recommended)

```json
{
  "mcpServers": {
    "mochi": {
      "command": "npx",
      "args": ["-y", "@fredrika/mcp-mochi"],
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
   git clone https://github.com/fredrika/mcp-mochi.git
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

### `mochi_create_flashcard`
Create a new flashcard in Mochi.
- `content`: Markdown content (separate front/back with `---`)
- `deck-id`: ID of the deck (use `mochi_list_decks` to find)
- `template-id`: (optional) Template to use
- `fields`: (optional) Map of field IDs to values (required with template)
- `manual-tags`: (optional) Array of tags

### `mochi_create_card_from_template`
Create a flashcard using a template with field **names** (not IDs). The MCP automatically maps names to IDs.
- `template-id`: Template ID (use `mochi_list_templates` to find)
- `deck-id`: Deck ID
- `fields`: Map of field names to values (e.g., `{"Front": "Question?", "Back": "Answer"}`)
- `manual-tags`: (optional) Array of tags

### `mochi_update_flashcard`
Update or delete a flashcard. Set `trashed?` to `true` to delete.
- `card-id`: ID of the card to update
- Any updatable card fields

### `mochi_add_attachment`
Add an attachment (image, audio, etc.) to a card using base64 data.
- `card-id`: ID of the card
- `data`: Base64-encoded file data
- `filename`: Filename with extension (e.g., `image.png`)
- `content-type`: (optional) MIME type (inferred from filename if omitted)

### `mochi_list_flashcards`
List flashcards (paginated).
- `deck-id`: (optional) Filter by deck
- `limit`: (optional) 1-100
- `bookmark`: (optional) Pagination token

### `mochi_list_decks`
List all decks.
- `bookmark`: (optional) Pagination token

### `mochi_list_templates`
List all templates with their field definitions.
- `bookmark`: (optional) Pagination token

### `mochi_get_due_cards`
Get flashcards due for review.
- `deck-id`: (optional) Filter by deck
- `date`: (optional) ISO 8601 date (defaults to today)

## Examples

### Create a simple flashcard

```json
{
  "tool": "mochi_create_flashcard",
  "params": {
    "content": "What is MCP?\n---\nModel Context Protocol - a protocol for providing context to LLMs",
    "deck-id": "<DECK_ID>"
  }
}
```

### Create a card from template

```json
{
  "tool": "mochi_create_card_from_template",
  "params": {
    "template-id": "<TEMPLATE_ID>",
    "deck-id": "<DECK_ID>",
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
  "tool": "mochi_get_due_cards",
  "params": {}
}
```
