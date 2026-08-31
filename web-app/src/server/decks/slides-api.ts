import "server-only";
import type { DeckSlide } from "@/lib/decks/deck-plan";

const PRESENTATIONS = "https://slides.googleapis.com/v1/presentations";

const IMAGE_URL_LIMIT = 2000;

const NOTES_FIELDS =
  "slides.objectId,slides.slideProperties.notesPage.notesProperties.speakerNotesObjectId";

export type SlidesRequest = Record<string, unknown>;

export type CreatedPresentation = { presentationId: string; firstSlideId: string | null };

export type SlidesApi = {
  create(title: string): Promise<CreatedPresentation>;
  batchUpdate(presentationId: string, requests: readonly SlidesRequest[]): Promise<void>;
  notesShapes(presentationId: string): Promise<Map<string, string>>;
};

export function slidesWebViewLink(presentationId: string) {
  return `https://docs.google.com/presentation/d/${presentationId}/edit`;
}

export function slideObjectId(index: number) {
  return `slide-${index}`;
}

export function deckStructureRequests(
  slides: readonly DeckSlide[],
  imageUrls: ReadonlyMap<string, string>,
  defaultSlideId: string | null,
): SlidesRequest[] {
  const requests: SlidesRequest[] = slides.flatMap((slide, index) => {
    const url = imageUrls.get(slide.pageId);
    if (!url) throw new Error(`no picture for page ${slide.pageId}`);
    if (url.length > IMAGE_URL_LIMIT) {
      throw new Error(`the picture URL for page ${slide.pageId} is past what Slides will read`);
    }
    const pageObjectId = slideObjectId(index);

    return [
      {
        createSlide: {
          objectId: pageObjectId,
          insertionIndex: index,
          slideLayoutReference: { predefinedLayout: "BLANK" },
        },
      },
      {
        updatePageProperties: {
          objectId: pageObjectId,
          pageProperties: {
            pageBackgroundFill: { solidFill: { color: { rgbColor: slide.background } } },
          },
          fields: "pageBackgroundFill.solidFill.color",
        },
      },
      {
        createImage: {
          objectId: `image-${index}`,
          url,
          elementProperties: {
            pageObjectId,
            size: {
              width: { magnitude: slide.image.width, unit: "PT" },
              height: { magnitude: slide.image.height, unit: "PT" },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: slide.image.x,
              translateY: slide.image.y,
              unit: "PT",
            },
          },
        },
      },
    ];
  });

  if (defaultSlideId) requests.push({ deleteObject: { objectId: defaultSlideId } });
  return requests;
}

export function deckNotesRequests(
  slides: readonly DeckSlide[],
  notesShapes: ReadonlyMap<string, string>,
): SlidesRequest[] {
  return slides.flatMap((slide, index) => {
    const shapeId = notesShapes.get(slideObjectId(index));
    if (!shapeId || !slide.notes) return [];
    return [{ insertText: { objectId: shapeId, insertionIndex: 0, text: slide.notes } }];
  });
}

type Presentation = {
  presentationId?: string;
  slides?: {
    objectId?: string;
    slideProperties?: { notesPage?: { notesProperties?: { speakerNotesObjectId?: string } } };
  }[];
};

export function slidesApi(accessToken: string): SlidesApi {
  async function call<T>(url: string, init?: { body: unknown }): Promise<T> {
    const response = await fetch(url, {
      method: init ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init ? { "content-type": "application/json" } : {}),
      },
      ...(init ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!response.ok) {
      throw new Error(`Google Slides answered ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  }

  return {
    async create(title) {
      const made = await call<Presentation>(PRESENTATIONS, { body: { title } });
      if (!made.presentationId) throw new Error("Google Slides made a deck with no id");
      return {
        presentationId: made.presentationId,
        firstSlideId: made.slides?.[0]?.objectId ?? null,
      };
    },

    async batchUpdate(presentationId, requests) {
      if (requests.length === 0) return;
      await call(`${PRESENTATIONS}/${presentationId}:batchUpdate`, { body: { requests } });
    },

    async notesShapes(presentationId) {
      const deck = await call<Presentation>(
        `${PRESENTATIONS}/${presentationId}?fields=${encodeURIComponent(NOTES_FIELDS)}`,
      );
      const shapes = new Map<string, string>();
      for (const slide of deck.slides ?? []) {
        const shapeId =
          slide.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId ?? null;
        if (slide.objectId && shapeId) shapes.set(slide.objectId, shapeId);
      }
      return shapes;
    },
  };
}
