import { describe, it, expect, beforeEach } from "vitest";
import { MockInstagramGraphProvider } from "../providers/mock-provider.js";
import { confirmationStore, ConfirmationError } from "../security/confirmation.js";
import { previewPublishImageTool, executePublishImageTool } from "./publish-image.js";
import { previewPublishVideoTool, executePublishVideoTool } from "./publish-video.js";
import { previewPublishCarouselTool, executePublishCarouselTool } from "./publish-carousel.js";
import { previewSchedulePostTool, executeSchedulePostTool } from "./schedule-post.js";

describe("Publishing & Scheduling Tools (Features 4, 5, 6, 15)", () => {
  let provider: MockInstagramGraphProvider;

  beforeEach(() => {
    confirmationStore.clear();
    provider = new MockInstagramGraphProvider();
  });

  // Feature 4: Publish Image
  describe("Feature 4: Publish Image", () => {
    it("should generate preview and confirmation, then execute image publication", async () => {
      const preview = await previewPublishImageTool.execute({
        image_url: "https://example.com/photo.jpg",
        caption: "A stunning sunset #nature",
      });

      expect(preview.confirmation_id).toBeDefined();
      expect(preview.action).toBe("PUBLISH_MEDIA");
      expect(preview.preview_summary).toContain("https://example.com/photo.jpg");
      expect(preview.preview_summary).toContain("A stunning sunset #nature");

      const exec = await executePublishImageTool.execute(
        { confirmation_id: preview.confirmation_id },
        provider
      );

      expect(exec.success).toBe(true);
      expect(exec.published_media_id).toBeDefined();
      expect(confirmationStore.activeCount).toBe(0); // Burned
    });

    it("should reject invalid non-https image URL", async () => {
      await expect(
        previewPublishImageTool.execute({
          image_url: "http://insecure.com/photo.jpg",
        })
      ).rejects.toThrow();
    });
  });

  // Feature 5: Publish Video / Reels
  describe("Feature 5: Publish Video / Reels", () => {
    it("should generate preview and confirmation, then execute Reels publication", async () => {
      const preview = await previewPublishVideoTool.execute({
        video_url: "https://example.com/video.mp4",
        caption: "Exciting new Reel! 🎬",
        is_reels: true,
      });

      expect(preview.confirmation_id).toBeDefined();
      expect(preview.media_type).toBe("REELS");
      expect(preview.preview_summary).toContain("REELS");

      const exec = await executePublishVideoTool.execute(
        { confirmation_id: preview.confirmation_id },
        provider
      );

      expect(exec.success).toBe(true);
      expect(exec.published_media_id).toBeDefined();
    });
  });

  // Feature 6: Publish Carousel
  describe("Feature 6: Publish Carousel", () => {
    it("should generate preview and confirmation, then execute carousel with multiple items", async () => {
      const preview = await previewPublishCarouselTool.execute({
        items: [
          { media_type: "IMAGE", url: "https://example.com/slide1.jpg" },
          { media_type: "IMAGE", url: "https://example.com/slide2.jpg" },
          { media_type: "VIDEO", url: "https://example.com/slide3.mp4" },
        ],
        caption: "Swipe to see all slides! 👉",
      });

      expect(preview.confirmation_id).toBeDefined();
      expect(preview.item_count).toBe(3);
      expect(preview.preview_summary).toContain("CAROUSEL with 3 items");

      const exec = await executePublishCarouselTool.execute(
        { confirmation_id: preview.confirmation_id },
        provider
      );

      expect(exec.success).toBe(true);
      expect(exec.item_count).toBe(3);
    });

    it("should reject carousels with fewer than 2 items", async () => {
      await expect(
        previewPublishCarouselTool.execute({
          items: [{ media_type: "IMAGE", url: "https://example.com/single.jpg" }],
        })
      ).rejects.toThrow(/at least 2 items/);
    });
  });

  // Feature 15: Schedule Post
  describe("Feature 15: Schedule Post", () => {
    it("should preview and schedule post in future", async () => {
      // 1 day in the future
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const preview = await previewSchedulePostTool.execute({
        scheduled_at: futureDate,
        media_type: "IMAGE",
        image_url: "https://example.com/scheduled.jpg",
        caption: "Scheduled post coming tomorrow!",
      });

      expect(preview.confirmation_id).toBeDefined();
      expect(preview.action).toBe("SCHEDULE_MEDIA");
      expect(preview.scheduled_at).toBe(futureDate);

      const exec = await executeSchedulePostTool.execute(
        { confirmation_id: preview.confirmation_id },
        provider
      );

      expect(exec.success).toBe(true);
      expect(exec.status).toBe("scheduled");
      expect(exec.scheduled_at).toBe(futureDate);
    });

    it("should reject scheduling in the past or less than 5 minutes out", async () => {
      const pastDate = new Date(Date.now() - 60000).toISOString();
      await expect(
        previewSchedulePostTool.execute({
          scheduled_at: pastDate,
          media_type: "IMAGE",
          image_url: "https://example.com/photo.jpg",
        })
      ).rejects.toThrow(/at least 5 minutes in the future/);
    });
  });

  // Cross-tool security
  describe("Cross-Tool Security Invariant", () => {
    it("should reject execute_publish_image when presented with confirmation from preview_publish_video", async () => {
      const vidPreview = await previewPublishVideoTool.execute({
        video_url: "https://example.com/video.mp4",
      });

      await expect(
        executePublishImageTool.execute({ confirmation_id: vidPreview.confirmation_id }, provider)
      ).rejects.toThrow(ConfirmationError);
    });
  });
});
