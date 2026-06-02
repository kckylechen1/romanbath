import { generateImage as zcGenerateImage } from "./zeroclawService";

export interface ImageGenRequest {
  prompt: string;
  resolution?: "1k" | "2k";
}

export interface ImageGenResponse {
  success: boolean;
  image_data_url?: string;
  error?: string;
}

export const extractImagePrompt = (text: string): string | null => {
  const match = text.match(/\[图片提示词\]\s*\n([\s\S]*?)(?=\n\n\[|\n\[|$)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
};

export const generateImage = async (
  request: ImageGenRequest,
): Promise<ImageGenResponse> => {
  try {
    const result = await zcGenerateImage(request.prompt, request.resolution);
    if (result.url) {
      return { success: true, image_data_url: result.url };
    }
    return { success: false, error: "No image URL returned" };
  } catch (e: any) {
    return { success: false, error: e?.message || "Image generation failed" };
  }
};
