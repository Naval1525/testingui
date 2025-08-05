import { axiosInstance } from "../lib/axiosInstance";
import { getAuthHeaders } from "./api";

// Available models for generation
export const AVAILABLE_MODELS = {
  IMAGE: {
    'recraft-v3': {
      name: 'Recraft AI v3',
      description: 'Realistic photographic image generation',
      provider: 'Recraft AI',
      imageSize: '1024x1024'
    },
    'imagen': {
      name: 'Google Imagen',
      description: 'High-quality image generation',
      provider: 'Google Gemini',
      imageSize: 'Variable'
    }
  },
  VIDEO: {
    'kling-v2.1-master': {
      name: 'Kling v2.1 Master',
      description: 'Image-to-video generation',
      provider: 'Fal.ai',
      duration: '5 seconds',
      resolution: 'Variable'
    },
    'gen4_turbo': {
      name: 'RunwayML Gen4 Turbo',
      description: 'Advanced video generation',
      provider: 'RunwayML',
      duration: '5 seconds',
      resolution: '1280:720'
    }
  }
};

// Unified chat API wrapper
export const chatApi = {
  // Generate image using the new unified chat endpoint
  generateImage: async ({ 
    visual_prompt, 
    art_style, 
    uuid, 
    project_id, 
    model = 'recraft-v3' 
  }) => {
    try {
      // Prepare a safe prompt: remove non-ASCII chars, line breaks, collapse whitespace, clamp length
      const MAX_PROMPT_LENGTH = 800; // keep strictly below backend 950-char limit
      const sanitisedPrompt = (visual_prompt || "")
        .replace(/[^\u0020-\u007E]/g, "") // strip non-printable / non-ASCII
        .replace(/\n+/g, " ")           // remove newlines
        .replace(/\s+/g, " ")           // collapse whitespace
        .trim();
      const safePrompt = sanitisedPrompt.substring(0, MAX_PROMPT_LENGTH);

      const payload = {
        model,
        gen_type: 'image',
        uuid,
        visual_prompt: safePrompt,
        art_style: art_style && art_style.trim() ? art_style.trim() : "realistic",
        projectId: project_id
      };

      const headers = await getAuthHeaders();
      const { data } = await axiosInstance.post("/chat", payload, {
        headers,
      });
      console.log("Chat API image generation response:", data);
      return data;
    } catch (error) {
      if (error.response?.data) {
        throw new Error(typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data));
      }
      console.error("Error in chatApi.generateImage:", error);
      throw error;
    }
  },

  // Generate video using the new unified chat endpoint
  generateVideo: async ({ 
    animation_prompt, 
    art_style, 
    image_s3_key, 
    uuid, 
    project_id, 
    model = 'kling-v2.1-master' 
  }) => {
    try {
      const payload = {
        model,
        gen_type: 'video',
        uuid,
        animation_prompt,
        image_s3_key,
        art_style: art_style && art_style.trim() ? art_style.trim() : "realistic",
        projectId: project_id
      };

      const headers = await getAuthHeaders();
      const { data } = await axiosInstance.post("/chat", payload, {
        headers,
      });
      console.log("Chat API video generation response:", data);
      return data;
    } catch (error) {
            if (error.response?.data) {
        throw new Error(typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data));
      }
      console.error("Error in chatApi.generateVideo:", error);
      throw error;
    }
  },

  // Get available models for a specific generation type
  getAvailableModels: (genType) => {
    return AVAILABLE_MODELS[genType.toUpperCase()] || {};
  },

  // Get default model for a generation type
  getDefaultModel: (genType) => {
    const models = AVAILABLE_MODELS[genType.toUpperCase()];
    if (!models) return null;
    
    // Return the first model as default
    return Object.keys(models)[0];
  }
}; 