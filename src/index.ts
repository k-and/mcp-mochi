#!/usr/bin/env node

import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import FormData from "form-data";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

dotenv.config();

/**
 * Custom error class for Mochi API errors
 *
 * Handles both array and object error responses from the API:
 * - Array: ["Error message 1", "Error message 2"]
 * - Object: { "field": "Error message" }
 */
class MochiError extends Error {
  errors: string[] | Record<string, string>;
  statusCode: number;

  constructor(errors: string[] | Record<string, string>, statusCode: number) {
    super(
      Array.isArray(errors)
        ? errors.join(", ")
        : Object.values(errors).join(", ")
    );
    this.errors = errors;
    this.statusCode = statusCode;
    this.name = "MochiError";
  }
}

// Zod schemas for request validation
const CreateCardFieldSchema = z.object({
  id: z.string().describe("Unique identifier for the field"),
  value: z.string().describe("Value of the field"),
});

const CreateCardRequestSchema = z.object({
  content: z
    .string()
    .min(1)
    .describe(
      "Markdown content of the card. Separate front and back using a horizontal rule (---) or use brackets for {{cloze deletion}}."
    ),
  "deck-id": z.string().min(1).describe("ID of the deck to create the card in"),
  "template-id": z
    .string()
    .optional()
    .nullable()
    .default(null)
    .describe(
      "Optional template ID to use for the card. Defaults to null if not set."
    ),
  "manual-tags": z
    .array(z.string())
    .optional()
    .describe("Optional array of tags to add to the card"),
  fields: z
    .record(z.string(), CreateCardFieldSchema)
    .optional()
    .describe(
      "Map of field IDs to field values. Required only when using a template"
    ),
});

const UpdateCardRequestSchema = z.object({
  content: z
    .string()
    .optional()
    .describe("Updated markdown content of the card"),
  "deck-id": z
    .string()
    .optional()
    .describe("ID of the deck to move the card to"),
  "template-id": z
    .string()
    .optional()
    .describe("Template ID to use for the card"),
  "archived?": z.boolean().optional().describe("Whether the card is archived"),
  "trashed?": z.string().optional().describe("Whether the card is trashed"),
  fields: z
    .record(z.string(), CreateCardFieldSchema)
    .optional()
    .describe("Updated map of field IDs to field values"),
});

const ListDecksParamsSchema = z.object({
  bookmark: z
    .string()
    .optional()
    .describe("Pagination bookmark for fetching next page of results"),
});

const ListCardsParamsSchema = z.object({
  "deck-id": z.string().optional().describe("Get cards from deck ID"),
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Number of cards to return per page (1-100)"),
  bookmark: z
    .string()
    .optional()
    .describe("Pagination bookmark for fetching next page of results"),
});

const ListTemplatesParamsSchema = z.object({
  bookmark: z
    .string()
    .optional()
    .describe("Pagination bookmark for fetching next page of results"),
});

const GetDueCardsParamsSchema = z.object({
  "deck-id": z
    .string()
    .optional()
    .describe("Optional deck ID to filter due cards by a specific deck"),
  date: z
    .string()
    .optional()
    .describe(
      "Optional ISO 8601 date to get cards due on that date. Defaults to today."
    ),
});

const CreateCardFromTemplateSchema = z.object({
  "template-id": z
    .string()
    .min(1)
    .describe("ID of the template to use. Get this from mochi_list_templates."),
  "deck-id": z
    .string()
    .min(1)
    .describe(
      "ID of the deck to create the card in. Get this from mochi_list_decks."
    ),
  fields: z
    .record(z.string(), z.string())
    .describe(
      'Map of field NAMES (not IDs) to values. E.g., { "Word": "serendipity" } or { "Front": "Question?", "Back": "Answer" }'
    ),
  "manual-tags": z
    .array(z.string())
    .optional()
    .describe("Optional array of tags to add to the card"),
});

// Schema for adding attachments
const AddAttachmentSchema = z.object({
  "card-id": z.string().min(1).describe("ID of the card to attach the file to"),
  data: z.string().min(1).describe("Base64-encoded file data"),
  filename: z
    .string()
    .min(1)
    .describe("Filename with extension (e.g., 'image.png', 'audio.mp3')"),
  "content-type": z
    .string()
    .optional()
    .describe(
      "MIME type of the file (e.g., 'image/png'). Can be inferred from filename if not provided."
    ),
});

type AddAttachmentRequest = z.infer<typeof AddAttachmentSchema>;

const TemplateFieldSchema = z.object({
  id: z.string().describe("Unique identifier for the template field"),
  name: z.string().describe("Display name of the field"),
  pos: z.string().describe("Position of the field in the template"),
  type: z
    .string()
    .optional()
    .nullable()
    .describe(
      "Field type: null/text for user input, or ai/speech/translate/dictionary for auto-generated"
    ),
  source: z
    .string()
    .optional()
    .nullable()
    .describe("Source field ID for auto-generated fields"),
  options: z
    .object({
      "multi-line?": z
        .boolean()
        .optional()
        .describe("Whether the field supports multiple lines of text"),
    })
    .passthrough()
    .optional()
    .describe("Additional options for the field"),
});

const TemplateSchema = z
  .object({
    id: z.string().describe("Unique identifier for the template"),
    name: z.string().describe("Display name of the template"),
    content: z.string().describe("Template content in markdown format"),
    pos: z.string().describe("Position of the template in the list"),
    fields: z
      .record(z.string(), TemplateFieldSchema)
      .describe("Map of field IDs to field definitions"),
  })
  .strip();

const ListTemplatesResponseSchema = z
  .object({
    bookmark: z.string().describe("Pagination bookmark for fetching next page"),
    docs: z.array(TemplateSchema).describe("Array of templates"),
  })
  .strip();

type ListTemplatesParams = z.infer<typeof ListTemplatesParamsSchema>;
type ListTemplatesResponse = z.infer<typeof ListTemplatesResponseSchema>;
type ListCardsParams = z.infer<typeof ListCardsParamsSchema>;
type ListDecksParams = z.infer<typeof ListDecksParamsSchema>;
type CreateCardRequest = z.infer<typeof CreateCardRequestSchema>;
type UpdateCardRequest = z.infer<typeof UpdateCardRequestSchema>;
type GetDueCardsParams = z.infer<typeof GetDueCardsParamsSchema>;
type CreateCardFromTemplateParams = z.infer<
  typeof CreateCardFromTemplateSchema
>;

// Response Zod schemas
const CardSchema = z
  .object({
    id: z.string().describe("Unique identifier for the card"),
    tags: z
      .array(z.string())
      .describe("Array of tags associated with the card"),
    content: z
      .string()
      .describe(
        'Markdown content of the card. Separate front and back of card with "---"'
      ),
    name: z.string().describe("Display name of the card"),
    "deck-id": z.string().describe("ID of the deck containing the card"),
    fields: z
      .record(z.unknown())
      .optional()
      .describe(
        "Map of field IDs to field values. Need to match the field IDs in the template"
      ),
  })
  .strip();

const CreateCardResponseSchema = CardSchema.strip();

const ListCardsResponseSchema = z
  .object({
    bookmark: z.string().describe("Pagination bookmark for fetching next page"),
    docs: z.array(CardSchema).describe("Array of cards"),
  })
  .strip();

type CreateCardResponse = z.infer<typeof CreateCardResponseSchema>;
type ListDecksResponse = z.infer<typeof ListDecksResponseSchema>["docs"];
type ListCardsResponse = z.infer<typeof ListCardsResponseSchema>;

const DeckSchema = z
  .object({
    id: z.string().describe("Unique identifier for the deck"),
    sort: z.number().describe("Sort order of the deck"),
    name: z.string().describe("Display name of the deck"),
    "archived?": z
      .boolean()
      .optional()
      .nullable()
      .describe("Whether the deck is archived"),
    "trashed?": z
      .object({ date: z.string() })
      .optional()
      .nullable()
      .describe("Whether the deck is trashed"),
  })
  .strip();

const ListDecksResponseSchema = z
  .object({
    bookmark: z.string().describe("Pagination bookmark for fetching next page"),
    docs: z.array(DeckSchema).describe("Array of decks"),
  })
  .strip();

const DueCardSchema = z
  .object({
    id: z.string().describe("Unique identifier for the card"),
    content: z.string().describe("Markdown content of the card"),
    name: z.string().describe("Display name of the card"),
    "deck-id": z.string().describe("ID of the deck containing the card"),
    "new?": z.boolean().describe("Whether the card is new (never reviewed)"),
  })
  .passthrough();

const GetDueCardsResponseSchema = z.object({
  cards: z.array(DueCardSchema).describe("Array of cards due for review"),
});

function getApiKey(): string {
  const apiKey = process.env.MOCHI_API_KEY;
  if (!apiKey) {
    console.error("MOCHI_API_KEY environment variable is not set");
    process.exit(1);
  }
  return apiKey;
}

const MOCHI_API_KEY = getApiKey();

export class MochiClient {
  private api: AxiosInstance;
  private token: string;

  constructor(token: string) {
    this.token = token;
    this.api = axios.create({
      baseURL: "https://app.mochi.cards/api/",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.token}:`).toString(
          "base64"
        )}`,
        "Content-Type": "application/json",
      },
    });
  }

  async createCard(request: CreateCardRequest): Promise<CreateCardResponse> {
    const response = await this.api.post("/cards", request);
    return CreateCardResponseSchema.parse(response.data);
  }

  async updateCard(
    cardId: string,
    request: UpdateCardRequest
  ): Promise<CreateCardResponse> {
    const response = await this.api.post(`/cards/${cardId}`, request);
    return CreateCardResponseSchema.parse(response.data);
  }

  async listDecks(params?: ListDecksParams): Promise<ListDecksResponse> {
    const validatedParams = params
      ? ListDecksParamsSchema.parse(params)
      : undefined;
    const response = await this.api.get("/decks", { params: validatedParams });
    return ListDecksResponseSchema.parse(response.data).docs.filter(
      (deck) => !deck["archived?"] && !deck["trashed?"]
    );
  }

  async listCards(params?: ListCardsParams): Promise<ListCardsResponse> {
    const validatedParams = params
      ? ListCardsParamsSchema.parse(params)
      : undefined;
    const response = await this.api.get("/cards", { params: validatedParams });
    return ListCardsResponseSchema.parse(response.data);
  }

  async listTemplates(
    params?: ListTemplatesParams
  ): Promise<ListTemplatesResponse> {
    const validatedParams = params
      ? ListTemplatesParamsSchema.parse(params)
      : undefined;
    const response = await this.api.get("/templates", {
      params: validatedParams,
    });
    return ListTemplatesResponseSchema.parse(response.data);
  }

  async getDueCards(
    params?: GetDueCardsParams
  ): Promise<z.infer<typeof GetDueCardsResponseSchema>> {
    const validatedParams = params
      ? GetDueCardsParamsSchema.parse(params)
      : undefined;
    const deckId = validatedParams?.["deck-id"];
    const endpoint = deckId ? `/due/${deckId}` : "/due";
    const queryParams = validatedParams?.date
      ? { date: validatedParams.date }
      : undefined;
    const response = await this.api.get(endpoint, { params: queryParams });
    return GetDueCardsResponseSchema.parse(response.data);
  }

  async getTemplate(
    templateId: string
  ): Promise<z.infer<typeof TemplateSchema>> {
    const response = await this.api.get(`/templates/${templateId}`);
    return TemplateSchema.parse(response.data);
  }

  async createCardFromTemplate(
    request: CreateCardFromTemplateParams
  ): Promise<CreateCardResponse> {
    // Fetch the template to get field definitions
    const template = await this.getTemplate(request["template-id"]);

    // Map field names to IDs
    const fieldNameToId: Record<string, string> = {};
    for (const [fieldId, field] of Object.entries(template.fields)) {
      fieldNameToId[field.name] = fieldId;
    }

    // Build the fields object with IDs
    const fields: Record<string, { id: string; value: string }> = {};
    const fieldValues: string[] = [];

    for (const [fieldName, value] of Object.entries(request.fields)) {
      const fieldId = fieldNameToId[fieldName];
      if (!fieldId) {
        throw new MochiError(
          [
            `Unknown field name: "${fieldName}". Available fields: ${Object.keys(
              fieldNameToId
            ).join(", ")}`,
          ],
          400
        );
      }
      fields[fieldId] = { id: fieldId, value };
      fieldValues.push(value);
    }

    // Build content from field values (joined with separator for multi-field templates)
    const content = fieldValues.join("\n---\n");

    const createRequest: CreateCardRequest = {
      content,
      "deck-id": request["deck-id"],
      "template-id": request["template-id"],
      fields,
      "manual-tags": request["manual-tags"],
    };

    return this.createCard(createRequest);
  }

  async addAttachment(
    request: AddAttachmentRequest
  ): Promise<{ filename: string; markdown: string }> {
    // Infer content-type from filename if not provided
    let contentType = request["content-type"];
    if (!contentType) {
      const ext = request.filename.split(".").pop()?.toLowerCase();
      const mimeTypes: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        mp3: "audio/mpeg",
        wav: "audio/wav",
        ogg: "audio/ogg",
        mp4: "video/mp4",
        pdf: "application/pdf",
      };
      contentType = mimeTypes[ext ?? ""] ?? "application/octet-stream";
    }

    // Convert base64 to Buffer
    const buffer = Buffer.from(request.data, "base64");

    // Create form data
    const formData = new FormData();
    formData.append("file", buffer, {
      filename: request.filename,
      contentType,
    });

    // Upload attachment
    await this.api.post(
      `/cards/${request["card-id"]}/attachments/${encodeURIComponent(
        request.filename
      )}`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Basic ${Buffer.from(`${this.token}:`).toString(
            "base64"
          )}`,
        },
      }
    );

    return {
      filename: request.filename,
      markdown: `![](@media/${request.filename})`,
    };
  }
}

// Server setup
const server = new Server(
  {
    name: "mcp-server/mochi",
    version: "1.0.3",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// Set up request handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "mochi_create_flashcard",
      description: `Create a new flashcard in Mochi. Use this whenever I ask questions about something that is interesting to remember. E.g. if I ask "What is the capital of France?", you should create a new flashcard with the content "What is the capital of France?\n---\nParis".

## Parameters

### deck-id (required)
ALWAYS look up deck-id with the mochi_list_decks tool.

### content (required)
The markdown content of the card. Separate front and back using a horizontal rule (---).

### template-id (optional)
When using a template, the field ids MUST match the template ones. If not using a template, omit this field. Consider using mochi_create_card_from_template instead for easier template-based card creation.

### fields (optional)
A map of field IDs (keyword) to field values. Only required when using a template. The field IDs must correspond to the fields defined on the template.

## Example without template
{
  "content": "What is the capital of France?\n---\nParis",
  "deck-id": "btmZUXWM"
}

## Example with template
{
  "content": "New card from API. ![](@media/foobar03.png)",
  "deck-id": "btmZUXWM",
  "template-id": "8BtaEAXe",
  "fields": {
    "name": {
      "id": "name",
      "value": "Hello,"
    },
    "JNEnw1e7": {
      "id": "JNEnw1e7",
      "value": "World!"
    }
  }
}

## Properties of good flashcards:
- **focused:** A question or answer involving too much detail will dull your concentration and stimulate incomplete retrievals, leaving some bulbs unlit.
- **precise** about what they're asking for. Vague questions will elicit vague answers, which won't reliably light the bulbs you're targeting.
- **consistent** answers, lighting the same bulbs each time you perform the task.
- **tractable**: Write prompts which you can almost always answer correctly. This often means breaking the task down, or adding cues
- **effortful**: You shouldn't be able to trivially infer the answer.
`,
      inputSchema: zodToJsonSchema(CreateCardRequestSchema),
      annotations: {
        title: "Create flashcard on Mochi",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    {
      name: "mochi_create_card_from_template",
      description: `Create a flashcard using a template with field names (not IDs). This is the preferred way to create template-based cards.

The MCP automatically:
1. Fetches the template to get field definitions
2. Maps provided field names to their IDs
3. Builds the fields object in the format Mochi expects

## Parameters

### template-id (required)
The ID of the template to use. Get available templates with mochi_list_templates.

### deck-id (required)
The ID of the deck to create the card in. Get available decks with mochi_list_decks.

### fields (required)
A map of field **names** (not IDs) to their values. The MCP will map names to IDs automatically.

### manual-tags (optional)
Array of tags to add to the card.

## Example: "Word" template (single field)
{
  "template-id": "mzROLUuD",
  "deck-id": "HGOW9dWP",
  "fields": {
    "Word": "serendipity"
  }
}

## Example: "Basic Flashcard" template (front/back)
{
  "template-id": "Jyv52qHg",
  "deck-id": "jJAIs2ZZ",
  "fields": {
    "Front": "What is the capital of France?",
    "Back": "Paris"
  }
}`,
      inputSchema: zodToJsonSchema(CreateCardFromTemplateSchema),
      annotations: {
        title: "Create flashcard from template on Mochi",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    {
      name: "mochi_update_flashcard",
      description: `Update or delete an existing flashcard in Mochi. To delete set trashed to true.`,
      inputSchema: zodToJsonSchema(
        z.object({
          "card-id": z.string(),
          ...UpdateCardRequestSchema.shape,
        })
      ),
      annotations: {
        title: "Update flashcard on Mochi",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    {
      name: "mochi_add_attachment",
      description: `Add an attachment (image, audio, etc.) to a card using base64 data.

Use this when you have base64-encoded file data (e.g., from images inserted in chat).

## Parameters

### card-id (required)
The ID of the card to attach the file to.

### data (required)
Base64-encoded file data.

### filename (required)
Filename with extension (e.g., "image.png", "audio.mp3").

### content-type (optional)
MIME type (e.g., "image/png"). Can be inferred from filename.

## Returns
The markdown reference to use in card content: \`![](@media/filename)\`

## Note
For URL-based images, just use markdown directly in card content: \`![description](https://example.com/image.png)\` - no attachment upload needed.`,
      inputSchema: zodToJsonSchema(AddAttachmentSchema),
      annotations: {
        title: "Add attachment to flashcard on Mochi",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    {
      name: "mochi_list_flashcards",
      description: "List flashcards in pages of 10 cards per page",
      inputSchema: zodToJsonSchema(ListCardsParamsSchema),
      annotations: {
        title: "List flashcards on Mochi",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "mochi_list_decks",
      description: "List all decks",
      inputSchema: zodToJsonSchema(ListDecksParamsSchema),
      annotations: {
        title: "List decks on Mochi",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "mochi_list_templates",
      description: `List all templates. Templates can be used to create cards with pre-defined fields.

Use mochi_create_card_from_template for easy template-based card creation with field names instead of IDs.

Example response:
{
  "bookmark": "g1AAAABAeJzLYWBgYMpgSmHgKy5JLCrJTq2MT8lPzkzJBYpzVBn4JgaaVZiC5Dlg8igyWQAxwRHd",
  "docs": [
    {
      "id": "YDELNZSu",
      "name": "Simple flashcard",
      "content": "# << Front >>\n---\n<< Back >>",
      "pos": "s",
      "fields": {
        "name": {
          "id": "name",
          "name": "Front",
          "pos": "a"
        },
        "Ysrde7Lj": {
          "id": "Ysrde7Lj",
          "name": "Back",
          "pos": "m",
          "options": {
            "multi-line?": true
          }
        }
      }
    },
    ...
  ]
}`,
      inputSchema: zodToJsonSchema(ListTemplatesParamsSchema),
      annotations: {
        title: "List templates on Mochi",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "mochi_get_due_cards",
      description: `Get flashcards that are due for review. Returns cards scheduled for review on the specified date (defaults to today).

## Parameters

### deck-id (optional)
Filter to only show due cards from a specific deck.

### date (optional)
ISO 8601 date string (e.g., "2026-01-11T00:00:00.000Z") to get cards due on that date. Defaults to today.`,
      inputSchema: zodToJsonSchema(GetDueCardsParamsSchema),
      annotations: {
        title: "Get due flashcards on Mochi",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ],
}));

// Create Mochi client
const mochiClient = new MochiClient(MOCHI_API_KEY);

// Add resource handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: `mochi://decks`,
        name: "All Mochi Decks",
        description: `List of all decks in Mochi.`,
        mimeType: "application/json",
      },
      {
        uri: `mochi://templates`,
        name: "All Mochi Templates",
        description: `List of all templates in Mochi.`,
        mimeType: "application/json",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  switch (uri) {
    case "mochi://decks": {
      const decks = await mochiClient.listDecks();

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              decks.map((deck) => ({
                id: deck.id,
                name: deck.name,
                archived: deck["archived?"],
              })),
              null,
              2
            ),
          },
        ],
      };
    }
    case "mochi://templates": {
      const templates = await mochiClient.listTemplates();
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(templates, null, 2),
          },
        ],
      };
    }
    default: {
      throw new Error("Invalid resource URI");
    }
  }
});

const CreateFlashcardPromptSchema = z.object({
  input: z
    .string()
    .describe("The information to base the flashcard on.")
    .optional(),
});

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "write-flashcard",
        description: "Write a flashcard based on user-provided information.",
        arguments: [
          {
            name: "input",
            description: "The information to base the flashcard on.",
          },
        ],
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const params = CreateFlashcardPromptSchema.parse(request.params.arguments);
  const { input } = params;

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Create a flashcard using the info below while adhering to these principles: 
- Keep questions and answers atomic.
- Utilize cloze prompts when applicable, like "This is a text with {{hidden}} part. Then don't use '---' separator.".
- Focus on effective retrieval practice by being concise and clear.
- Make it just challenging enough to reinforce specific facts.
Input: ${input}
`,
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "mochi_create_flashcard": {
        const validatedArgs = CreateCardRequestSchema.parse(
          request.params.arguments
        );
        const response = await mochiClient.createCard(validatedArgs);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
          isError: false,
        };
      }
      case "mochi_create_card_from_template": {
        const validatedArgs = CreateCardFromTemplateSchema.parse(
          request.params.arguments
        );
        const response = await mochiClient.createCardFromTemplate(
          validatedArgs
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
          isError: false,
        };
      }
      case "mochi_update_flashcard": {
        const { "card-id": cardId, ...updateArgs } = z
          .object({
            "card-id": z.string(),
            ...UpdateCardRequestSchema.shape,
          })
          .parse(request.params.arguments);
        const response = await mochiClient.updateCard(cardId, updateArgs);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
          isError: false,
        };
      }
      case "mochi_add_attachment": {
        const validatedArgs = AddAttachmentSchema.parse(
          request.params.arguments
        );
        const response = await mochiClient.addAttachment(validatedArgs);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
          isError: false,
        };
      }
      case "mochi_list_decks": {
        const validatedArgs = ListDecksParamsSchema.parse(
          request.params.arguments
        );
        const response = await mochiClient.listDecks(validatedArgs);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
          isError: false,
        };
      }
      case "mochi_list_flashcards": {
        const validatedArgs = ListCardsParamsSchema.parse(
          request.params.arguments
        );
        const response = await mochiClient.listCards(validatedArgs);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
          isError: false,
        };
      }
      case "mochi_list_templates": {
        const validatedArgs = ListTemplatesParamsSchema.parse(
          request.params.arguments
        );
        const response = await mochiClient.listTemplates(validatedArgs);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
          isError: false,
        };
      }
      case "mochi_get_due_cards": {
        const validatedArgs = GetDueCardsParamsSchema.parse(
          request.params.arguments
        );
        const response = await mochiClient.getDueCards(validatedArgs);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
          isError: false,
        };
      }
      default:
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${request.params.name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formattedErrors = error.errors.map((err) => {
        const path = err.path.join(".");
        const message =
          err.code === "invalid_type" && err.message.includes("Required")
            ? `Required field '${path}' is missing`
            : err.message;
        return `${path ? `${path}: ` : ""}${message}`;
      });
      return {
        content: [
          {
            type: "text",
            text: `Validation error:\n${formattedErrors.join("\n")}`,
          },
        ],
        isError: true,
      };
    }
    if (error instanceof MochiError) {
      return {
        content: [
          {
            type: "text",
            text: `Mochi API error (${error.statusCode}): ${error.message}`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
