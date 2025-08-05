import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import LoadingSpinner from "./LoadingSpinner";
import CharacterGenerator from "./CharacterGenerator";
import { useAuth } from "../hooks/useAuth";
import ChatLoginButton from "./ChatLoginButton";
import { ProjectHistoryDropdown } from "./ProjectHistoryDropdown";
import { webInfoApi } from "../services/web-info";
import { conceptWriterApi } from "../services/concept-writer";
import { segmentationApi } from "../services/segmentationapi";
import { chatApi } from "../services/chat";
import { s3Api } from "../services/s3";
import { projectApi } from "../services/project";
import ModelSelector from "./ModelSelector";
import CreditWidget from "./CreditWidget";

import StepList from "./chat-widget/StepList";
import InputArea from "./chat-widget/InputArea";
import { useProjectStore } from "../store/useProjectStore";
import { getTextCreditCost, getImageCreditCost, getVideoCreditCost, formatCreditDeduction } from "../lib/pricing";

import React from "react";

function ChatWidgetSidebar() {
  const { isAuthenticated, logout, user } = useAuth();

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedProject, setSelectedProject] = useState(() => {
    try {
      const stored = localStorage.getItem('project-store-selectedProject');
      return stored ? JSON.parse(stored) : null;
    } catch (e) {
      console.error(e);
      return null;
    }
  });
  const [storedVideosMap, setStoredVideosMap] = useState(() => {
    try {
      const stored = localStorage.getItem('project-store-selectedProject');
      if (stored) {
        const _project = JSON.parse(stored);
        return JSON.parse(localStorage.getItem(`project-store-videos`) || "{}");
      }
      return JSON.parse(localStorage.getItem("segmentVideos") || "{}");
    } catch (e) {
      console.error(e);
      return {};
    }
  });

  const [, setTimelineProgress] = useState({
    expected: 0,
    added: 0,
  });

  const [addingTimeline, setAddingTimeline] = useState(false);
  const [showProjectHistory, setShowProjectHistory] = useState(false);
  const [showCharacterGenerator, setShowCharacterGenerator] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [collapseSteps, setCollapseSteps] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const nameInputRef = useRef(null);

  // New 6-step flow states
  const [currentStep, setCurrentStep] = useState(0);
  const [stepStatus, setStepStatus] = useState({
    0: 'pending', // concept writer
    1: 'pending', // user chooses concept
    2: 'pending', // script generation
    3: 'pending', // user chooses script
    4: 'pending', // image generation
    5: 'pending', // video generation
  });
  
  const [concepts, setConcepts] = useState(null);
  const [selectedConcept, setSelectedConcept] = useState(null);
  const [scripts, setScripts] = useState(null);
  const [selectedScript, setSelectedScript] = useState(null);
  const [generatedImages, setGeneratedImages] = useState({});
  const [generatedVideos, setGeneratedVideos] = useState({});
  // Modal for long text preview
  const [showTextModal, setShowTextModal] = useState(false);
  const [modalText, setModalText] = useState("");
  const [generationProgress, setGenerationProgress] = useState({});
  // modal for viewing generated images
  const [showImageModal, setShowImageModal] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState(null);
  // video preview modal
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [modalVideoUrl, setModalVideoUrl] = useState(null);
  // model selection states
  const [selectedImageModel, setSelectedImageModel] = useState(chatApi.getDefaultModel('IMAGE'));
  const [selectedVideoModel, setSelectedVideoModel] = useState(chatApi.getDefaultModel('VIDEO'));
  // redo modal states
  const [showRedoModal, setShowRedoModal] = useState(false);
  const [redoStepId, setRedoStepId] = useState(null);
  const [redoImageModel, setRedoImageModel] = useState(chatApi.getDefaultModel('IMAGE'));
  const [redoVideoModel, setRedoVideoModel] = useState(chatApi.getDefaultModel('VIDEO'));

  // Credit deduction notification state
  const [creditDeductionMessage, setCreditDeductionMessage] = useState(null);



  const { fetchBalance } = useProjectStore();

  // utility to strip basic markdown formatting for table preview
  const stripMarkdown = (s = "") => s.replace(/\*\*|__|\*|_|`|#/g, "").trim();

  const steps = [
    { id: 0, name: 'Concept Writer', description: 'Generate video concepts' },
    { id: 1, name: 'Choose Concept', description: 'Select your preferred concept' },
    { id: 2, name: 'Script Generation', description: 'Generate script segments' },
    { id: 3, name: 'Choose Script', description: 'Select your preferred script' },
    { id: 4, name: 'Image Generation', description: 'Generate images for segments' },
    { id: 5, name: 'Video Generation', description: 'Generate videos from images' },
  ];

  useEffect(() => {
    const handleStorage = () => {
      try {
        const stored = localStorage.getItem('project-store-selectedProject');
        const newSelectedProject = stored ? JSON.parse(stored) : null;
        setSelectedProject(newSelectedProject);
        
        if (newSelectedProject) {
          setStoredVideosMap(
            JSON.parse(localStorage.getItem(`project-store-videos`) || "{}"),
          );
        } else {
          setStoredVideosMap(
            JSON.parse(localStorage.getItem("segmentVideos") || "{}"),
          );
        }
      } catch (e) {
        console.error(e);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (window?.electronAPI?.res?.timeline?.add) {
      window.electronAPI.res.timeline.add((_evt, payload) => {
        setTimelineProgress((prev) => ({
          ...prev,
          added: prev.added + Object.keys(payload || {}).length,
        }));
      });
    }
  }, []);

  // Load credit balance when user is authenticated
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      const { fetchBalance } = useProjectStore.getState();
      fetchBalance(user.id);
    }
  }, [isAuthenticated, user?.id]);

  // Load project data when selectedProject changes
  useEffect(() => {
    if (selectedProject) {
      loadProjectData();
    } else {
      resetFlow();
    }
  }, [selectedProject]);


  // Update step status based on current data
  useEffect(() => {
    if (!selectedProject) return;
    
    const newStepStatus = { ...stepStatus };
    
    // Step 0: Concept Writer - check if concepts exist
    if (concepts && concepts.length > 0) {
      newStepStatus[0] = 'done';
    } else {
      newStepStatus[0] = 'pending';
    }
    
    // Step 1: Choose Concept - check if concept is selected
    if (selectedConcept) {
      newStepStatus[1] = 'done';
    } else {
      newStepStatus[1] = 'pending';
    }
    
    // Step 2: Script Generation - check if scripts exist
    if (selectedScript && selectedScript.segments && selectedScript.segments.length > 0) {
      newStepStatus[2] = 'done';
    } else {
      newStepStatus[2] = 'pending';
    }
    
    // Step 3: Choose Script - check if script is selected
    if (selectedScript && selectedScript.segments && selectedScript.segments.length > 0) {
      newStepStatus[3] = 'done';
    } else {
      newStepStatus[3] = 'pending';
    }
    
    // Step 4: Image Generation - check if images exist (from API or generation)
    const hasImages = Object.keys(generatedImages).length > 0 || 
                     (selectedScript?.segments?.some(seg => seg.s3Key || seg.image_s3_key || seg.imageS3Key));
    if (hasImages) {
      newStepStatus[4] = 'done';
    } else {
      newStepStatus[4] = 'pending';
    }
    
    // Step 5: Video Generation - check if videos exist (from API or generation)
    const hasVideos = Object.keys(generatedVideos).length > 0 || 
                     (selectedScript?.segments?.some(seg => seg.videoUrl || seg.video_url));
    if (hasVideos) {
      newStepStatus[5] = 'done';
    } else {
      newStepStatus[5] = 'pending';
    }
    
    // Debug logging for step status updates
    if (hasImages || hasVideos) {
      console.log('Step status update:', {
        concepts: concepts?.length || 0,
        selectedConcept: !!selectedConcept,
        selectedScript: !!selectedScript,
        selectedScriptSegments: selectedScript?.segments?.length || 0,
        images: Object.keys(generatedImages).length,
        videos: Object.keys(generatedVideos).length,
        hasImages,
        hasVideos,
        newStepStatus
      });
    }
    
    setStepStatus(newStepStatus);
  }, [selectedProject, concepts, selectedConcept, scripts, selectedScript, generatedImages, generatedVideos]);

  const resetFlow = () => {
    setCurrentStep(0);
    setStepStatus({
      0: 'pending',
      1: 'pending',
      2: 'pending',
      3: 'pending',
      4: 'pending',
      5: 'pending',
    });
    setConcepts(null);
    setSelectedConcept(null);
    setScripts(null);
    setSelectedScript(null);
    setGeneratedImages({});
    setGeneratedVideos({});
    setGenerationProgress({});
    // Reset model selections to defaults
    setSelectedImageModel(chatApi.getDefaultModel('IMAGE'));
    setSelectedVideoModel(chatApi.getDefaultModel('VIDEO'));
  };

  // Helper function to show credit deduction after successful API response
  const showCreditDeduction = (serviceName, model = null, count = 1) => {
    let credits = 0;
    let message = '';

    switch (serviceName) {
      case 'Web Info Processing':
        credits = getTextCreditCost('web-info');
        message = formatCreditDeduction('Web Info Processing', credits);
        break;
      case 'Concept Generation':
        credits = getTextCreditCost('concept generator');
        message = formatCreditDeduction('Concept Generation', credits);
        break;
      case 'Script Generation':
        credits = getTextCreditCost('script & segmentation') * count;
        message = formatCreditDeduction('Script Generation', credits);
        break;
      case 'Image Generation':
        if (model) {
          credits = getImageCreditCost(model) * count;
          message = formatCreditDeduction(`Image Generation (${model})`, credits);
        } else {
          credits = getImageCreditCost('imagen') * count; // default to imagen
          message = formatCreditDeduction('Image Generation', credits);
        }
        break;
      case 'Video Generation':
        if (model) {
          credits = getVideoCreditCost(model, 5) * count; // 8 seconds default
          message = formatCreditDeduction(`Video Generation (${model})`, credits);
        } else {
          credits = getVideoCreditCost('veo2', 5) * count; // default to veo2
          message = formatCreditDeduction('Video Generation', credits);
        }
        break;
      default:
        message = `Credit deducted for ${serviceName}`;
    }

    setCreditDeductionMessage(message);
    setTimeout(() => setCreditDeductionMessage(null), 3000); // Clear after 3 seconds
    
    // Refresh balance if user is authenticated
    if (user?.id) {
      fetchBalance(user.id);
    }
  };

  // Helper function to show request failure message
  const showRequestFailed = (serviceName = null) => {
    const message = serviceName ? `${serviceName} request failed` : "Request failed";
    setCreditDeductionMessage(message);
    setTimeout(() => setCreditDeductionMessage(null), 3000);
  };

  const updateStepStatus = (stepId, status) => {
    setStepStatus(prev => ({
      ...prev,
      [stepId]: status
    }));
  };

  const getStepIcon = (stepId) => {
    const status = stepStatus[stepId];
    let icon;
    
    if (status === 'loading') {
      icon = '⏳';
    } else if (status === 'done') {
      icon = '✅';
    } else if (status === 'pending' && stepId === currentStep) {
      icon = '▶️';
    } else {
      icon = '⏸️';
    }
    
    return icon;
  };

  const isStepDisabled = (stepId) => {
    if (loading) return true;
    if (stepId === 0) return false; // First step is always enabled
    if (stepId === 1) return !concepts;
    if (stepId === 2) return !selectedConcept;
    if (stepId === 3) return !selectedScript || !selectedScript.segments;
    if (stepId === 4) return !selectedScript || !selectedScript.segments;
    if (stepId === 5) return Object.keys(generatedImages).length === 0;
    return true;
  };

  const handleStepClick = async (stepId) => {
    if (isStepDisabled(stepId) || loading) return;
    
    setCurrentStep(stepId);
    
    // Only run the step if it's not already done
    if (stepStatus[stepId] !== 'done') {
      switch (stepId) {
        case 0:
          await runConceptWriter();
          break;
        case 2:
          await runScriptGeneration();
          break;
        // For image (4) and video (5) generation, we now only switch to the step so the
        // user can pick a model first. Generation starts from an explicit button in the UI.
        case 4:
        case 5:
          // Do nothing here; handled by explicit Generate button.
          break;
      }
    }
  };

  const handleRedoStep = async (stepId) => {
    if (loading) return;
    
    // For steps that need model selection, show modal
    if (stepId === 4 || stepId === 5) {
      setRedoStepId(stepId);
      setRedoImageModel(selectedImageModel);
      setRedoVideoModel(selectedVideoModel);
      setShowRedoModal(true);
      return;
    }
    
    // For other steps, run immediately
    setCurrentStep(stepId);
    
    switch (stepId) {
      case 0:
        await runConceptWriter();
        break;
      case 2:
        await runScriptGeneration();
        break;
    }
  };

  const handleRedoWithModel = async () => {
    if (loading || !redoStepId) return;
    
    setShowRedoModal(false);
    setCurrentStep(redoStepId);
    
    // Update the main model selections with the redo selections
    if (redoStepId === 4) {
      setSelectedImageModel(redoImageModel);
    } else if (redoStepId === 5) {
      setSelectedVideoModel(redoVideoModel);
    }
    
    switch (redoStepId) {
      case 4:
        await runImageGeneration();
        break;
      case 5:
        await runVideoGeneration();
        break;
    }
    
    setRedoStepId(null);
  };

  const runConceptWriter = async () => {
    if (!prompt.trim()) {
      setError("Please enter a prompt first");
      return;
    }

    setLoading(true);
    setError(null);
    updateStepStatus(0, 'loading');

    try {
      console.log("Starting pipeline with web-info...");
      const webInfoResult = await webInfoApi.processWebInfo(prompt, selectedProject?.id);
      console.log("Web-info response:", webInfoResult);

      console.log("Calling concept-writer...");
      const webInfoContent = webInfoResult.choices[0].message.content;
      const conceptsResult = await conceptWriterApi.generateConcepts(
        prompt,
        webInfoContent,
        selectedProject?.id,
      );

      console.log("Concept-writer response:", conceptsResult);
      
      // Show combined credit deduction for both API calls (web-info + concept generation)
      const webInfoCredits = getTextCreditCost('web-info');
      const conceptCredits = getTextCreditCost('concept generator');
      const totalCredits = webInfoCredits + conceptCredits;
      const message = formatCreditDeduction('Concept Writer Process', totalCredits);
      
      setCreditDeductionMessage(message);
      setTimeout(() => setCreditDeductionMessage(null), 3000);
      
      // Refresh balance if user is authenticated
      if (user?.id) {
        fetchBalance(user.id);
      }
      
      setConcepts(conceptsResult.concepts);
      updateStepStatus(0, 'done');
      setCurrentStep(1);
    } catch (error) {
      console.error("Error in concept writer:", error);
      showRequestFailed("Concept Generation");
      setError(error.message || "Failed to generate concepts. Please try again.");
      updateStepStatus(0, 'pending');
    } finally {
      setLoading(false);
    }
  };

  const runScriptGeneration = async () => {
    if (!selectedConcept) {
      setError("Please select a concept first");
      return;
    }

    setLoading(true);
    setError(null);
    updateStepStatus(2, 'loading');

    try {
      const [res1, res2] = await Promise.all([
        segmentationApi.getSegmentation({
          prompt,
          concept: selectedConcept.title,
          negative_prompt: "",
          project_id: selectedProject?.id,
        }),
        segmentationApi.getSegmentation({
          prompt,
          concept: selectedConcept.title,
          negative_prompt: "",
          project_id: selectedProject?.id,
        }),
      ]);
      
      // Show credit deduction after successful API responses
      showCreditDeduction("Script Generation", null, 2);
      setScripts({ response1: res1, response2: res2 });
      updateStepStatus(2, 'done');
      setCurrentStep(3);
    } catch (error) {
      console.error("Error in script generation:", error);
      showRequestFailed("Script Generation");
      setError(error.message || "Failed to generate scripts. Please try again.");
      updateStepStatus(2, 'pending');
    } finally {
      setLoading(false);
    }
  };

  const runImageGeneration = async () => {
    if (!selectedScript) {
      setError("Please select a script first");
      return;
    }

    setLoading(true);
    setError(null);
    updateStepStatus(4, 'loading');
    setGenerationProgress({});

    try {
      const artStyle = selectedScript.artStyle || "";
      const imagesMap = {};

      // Only process segments that actually have a visual prompt
      const segmentsToGenerate = selectedScript.segments.filter(seg => seg.visual && seg.visual.trim());
      if (segmentsToGenerate.length === 0) {
        setError("No visual prompts found in script segments.");
        setLoading(false);
        updateStepStatus(4, 'pending');
        return;
      }

      // Create parallel promises for all valid segments
      const imagePromises = segmentsToGenerate.map(async (segment, index) => {
        setGenerationProgress((prev) => ({
          ...prev,
          [segment.id]: {
            type: "image",
            status: "generating",
            index: index + 1,
            total: segmentsToGenerate.length,
          },
        }));

        try {
          const result = await chatApi.generateImage({
            visual_prompt: segment.visual,
            art_style: artStyle,
            uuid: segment.id,
            project_id: selectedProject?.id,
            model: selectedImageModel,
          });

          if (result.s3_key) {
            const imageUrl = await s3Api.downloadImage(result.s3_key);
            imagesMap[segment.id] = imageUrl;
            segment.s3Key = result.s3_key;

            setGenerationProgress((prev) => ({
              ...prev,
              [segment.id]: {
                type: "image",
                status: "completed",
                index: index + 1,
                total: segmentsToGenerate.length,
              },
            }));

            return { segmentId: segment.id, imageUrl, s3Key: result.s3_key };
          } else {
            setGenerationProgress((prev) => ({
              ...prev,
              [segment.id]: {
                type: "image",
                status: "error",
                index: index + 1,
                total: segmentsToGenerate.length,
                error: "No image key returned from API",
              },
            }));
            return null;
          }
        } catch (err) {
          console.error(`Error generating image for segment ${segment.id}:`, err);
          setGenerationProgress((prev) => ({
            ...prev,
            [segment.id]: {
              type: "image",
              status: "error",
              index: index + 1,
              total: segmentsToGenerate.length,
              error: err.message,
            },
          }));
          return null;
        }
      });

      // Wait for all image generation requests to complete
      const imgResults = await Promise.allSettled(imagePromises);
      if (imgResults.some(r => r.status === 'rejected')) {
        showRequestFailed('Image Generation');
      }

      // Show credit deduction after successful generation for all segments
      const totalSegments = segmentsToGenerate.length;
      showCreditDeduction("Image Generation", selectedImageModel, totalSegments);

      // Update segments with s3Key for video generation
      const segmentsWithS3Key = selectedScript.segments.map(segment => ({
        ...segment,
        s3Key: segment.s3Key
      }));

      setGeneratedImages(imagesMap);
      
      // Update selectedScript with the segments that now have s3Key
      setSelectedScript(prev => ({
        ...prev,
        segments: segmentsWithS3Key
      }));

      updateStepStatus(4, 'done');
      setCurrentStep(5);
    } catch (error) {
      console.error("Error in image generation:", error);
      showRequestFailed("Image Generation");
      setError(error.message || "Failed to generate images. Please try again.");
      updateStepStatus(4, 'pending');
    } finally {
      setLoading(false);
    }
  };

  const runVideoGeneration = async () => {
    // Check if we have any images available from the API response
    if (Object.keys(generatedImages).length === 0) {
      setError("Please generate images first");
      return;
    }

    setLoading(true);
    setError(null);
    updateStepStatus(5, 'loading');
    setGenerationProgress({});

    try {
      const segments = selectedScript.segments;
      const artStyle = selectedScript.artStyle || "";
      const videosMap = {};
      
      // Count valid segments (those with images)
      const validSegments = segments.filter(segment => {
        const segmentIdVariants = [segment.id, `seg-${segment.id}`, segment.segmentId, segment.uuid];
        return segmentIdVariants.some(id => generatedImages[id]);
      });

      // Create parallel promises for all valid segments
      const videoPromises = validSegments.map(async (segment, index) => {
        // Check if this segment has an image in the generatedImages map
        // Try different segment ID formats to match with generatedImages
        const segmentIdVariants = [
          segment.id,
          `seg-${segment.id}`,
          segment.segmentId,
          segment.uuid
        ];
        
        const matchingImageKey = segmentIdVariants.find(id => generatedImages[id]);
        if (!matchingImageKey) {
          console.log(`Skipping segment ${segment.id} - no image available. Tried IDs:`, segmentIdVariants);
          return null;
        }

        setGenerationProgress((prev) => ({
          ...prev,
          [segment.id]: {
            type: "video",
            status: "generating",
            index: index + 1,
            total: validSegments.length,
          },
        }));

        try {
          // Extract s3Key from the image URL in generatedImages
          const imageUrl = generatedImages[matchingImageKey];
          let imageS3Key = null;
          
          if (imageUrl && imageUrl.includes('cloudfront.net/')) {
            // Extract s3Key from CloudFront URL
            const urlParts = imageUrl.split('cloudfront.net/');
            if (urlParts.length > 1) {
              imageS3Key = urlParts[1];
            }
          }
          
          console.log(`Generating video for segment ${segment.id} with imageS3Key: ${imageS3Key}`);
          const result = await chatApi.generateVideo({
            animation_prompt: segment.animation || segment.visual,
            art_style: artStyle,
            image_s3_key: imageS3Key,
            uuid: segment.id,
            project_id: selectedProject?.id,
            model: selectedVideoModel,
          });

          console.log(`Video generation result for segment ${segment.id}:`, result);

          if (result.s3_key) {
            const videoUrl = await s3Api.downloadVideo(result.s3_key);
            videosMap[segment.id] = videoUrl;

            setGenerationProgress((prev) => ({
              ...prev,
              [segment.id]: {
                type: "video",
                status: "completed",
                index: index + 1,
                total: validSegments.length,
              },
            }));

            return { segmentId: segment.id, videoUrl };
          } else {
            console.warn(`No s3_key returned for segment ${segment.id}`);
            setGenerationProgress((prev) => ({
              ...prev,
              [segment.id]: {
                type: "video",
                status: "error",
                index: index + 1,
                total: validSegments.length,
                error: "No video key returned from API",
              },
            }));
            return null;
          }
        } catch (err) {
          console.error(`Error generating video for segment ${segment.id}:`, err);
          setGenerationProgress((prev) => ({
            ...prev,
            [segment.id]: {
              type: "video",
              status: "error",
              index: index + 1,
              total: validSegments.length,
              error: err.message,
            },
          }));
          return null;
        }
      });

      // Wait for all video generation requests to complete
      await Promise.allSettled(videoPromises);

      // Show credit deduction after successful generation for valid segments
      const totalValidSegments = validSegments.length;
      if (totalValidSegments > 0) {
        showCreditDeduction("Video Generation", selectedVideoModel, totalValidSegments);
      }

      setGeneratedVideos(videosMap);

      updateStepStatus(5, 'done');
    } catch (error) {
      console.error("Error in video generation:", error);
      showRequestFailed("Video Generation");
      setError(error.message || "Failed to generate videos. Please try again.");
      updateStepStatus(5, 'pending');
    } finally {
      setLoading(false);
    }
  };

  const handleConceptSelect = (concept) => {
    setSelectedConcept(concept);
    updateStepStatus(1, 'done');
    setCurrentStep(2);
  };

  const handleScriptSelect = (script) => {
    setSelectedScript(script);
    updateStepStatus(3, 'done');
    setCurrentStep(4);
  };

  const _sendVideosToTimeline = async () => {
    if (addingTimeline) return;

    let payload = [];
    if (selectedScript) {
      // Prefer the unified map so we cover both freshly generated and previously stored videos
      payload = selectedScript.segments
        .filter((s) => combinedVideosMap[s.id])
        .sort((a, b) => a.id - b.id)
        .map((s) => ({ id: s.id, url: combinedVideosMap[s.id] }));
    }

    // Fallback – use every video we currently know about
    if (payload.length === 0) {
      payload = Object.entries(combinedVideosMap).map(([id, url]) => {
        const numId = Number(id);
        return {
          id: isNaN(numId) ? id : numId,
          url,
        };
      });

      // If all IDs are numeric, sort them; otherwise keep original order
      const allNumeric = payload.every((p) => typeof p.id === 'number');
      if (allNumeric) {
        payload.sort((a, b) => a.id - b.id);
      }
    }

    if (payload.length === 0) {
      setError("No videos to add.");
      return;
    }

    let success = false;
    setAddingTimeline(true);
    try {
      const addByUrlWithDir = window?.api?.ext?.timeline?.addByUrlWithDir;
      const addByUrlFn = window?.api?.ext?.timeline?.addByUrl;
      if (addByUrlFn) {
        if (addByUrlWithDir) {
          await addByUrlWithDir(payload);
        } else {
          await addByUrlFn(payload);
        }
        success = true;
      } else if (window?.electronAPI?.req?.timeline?.addByUrl) {
        if (window.electronAPI.req.timeline.addByUrlWithDir) {
          await window.electronAPI.req.timeline.addByUrlWithDir(payload);
        } else {
          await window.electronAPI.req.timeline.addByUrl(payload);
        }
        success = true;
      } else if (window.require) {
        const { ipcRenderer } = window.require("electron");
        await ipcRenderer.invoke("extension:timeline:addByUrlWithDir", payload);
        success = true;
      }
    } catch (err) {
      console.error("timeline add failed", err);
    }

    if (success) {
      setTimelineProgress({ expected: payload.length, added: 0 });
    } else {
      setError("Failed to add videos to timeline.");
    }
    setAddingTimeline(false);
  };

  // add only one video (by segmentId) to timeline
  const _addSingleVideoToTimeline = async (segmentId) => {
    if (addingTimeline) return;
    const videoUrl = combinedVideosMap[segmentId] || combinedVideosMap[String(segmentId)];
    if (!videoUrl) {
      setError('Video not found.');
      return;
    }

    const payload = [{ id: Number(segmentId), url: videoUrl }];
    setAddingTimeline(true);
    let success = false;
    try {
      const addByUrlWithDir = window?.api?.ext?.timeline?.addByUrlWithDir;
      const addByUrlFn = window?.api?.ext?.timeline?.addByUrl;
      if (addByUrlFn) {
        if (addByUrlWithDir) {
          await addByUrlWithDir(payload);
        } else {
          await addByUrlFn(payload);
        }
        success = true;
      } else if (window?.electronAPI?.req?.timeline?.addByUrl) {
        if (window.electronAPI.req.timeline.addByUrlWithDir) {
          await window.electronAPI.req.timeline.addByUrlWithDir(payload);
        } else {
          await window.electronAPI.req.timeline.addByUrl(payload);
        }
        success = true;
      } else if (window.require) {
        const { ipcRenderer } = window.require('electron');
        await ipcRenderer.invoke('extension:timeline:addByUrlWithDir', payload);
        success = true;
      }
    } catch (err) {
      console.error('timeline add failed', err);
    }

    if (success) {
      setTimelineProgress({ expected: 1, added: 0 });
    } else {
      setError('Failed to add video to timeline.');
    }
    setAddingTimeline(false);
  };

  const canSendTimeline = Object.keys(generatedVideos).length > 0 || Object.keys(storedVideosMap).length > 0;

  // Helper functions for project management
  const clearProjectLocalStorage = () => {
    // Clear project selection from localStorage
    localStorage.removeItem('project-store-projects');
    localStorage.removeItem('project-store-selectedProject');
    setSelectedProject(null);
  };

  const loadProjectData = async () => {
    if (!selectedProject) return;
    
    try {
      setLoading(true);
      setError(null);
      
      console.log(`Loading project data for project ID: ${selectedProject.id}`);
      
      // Fetch project details and all related data from API
      const [
        projectDetails,
        projectConcepts,
        projectImages,
        projectVideos,
        projectSegmentations
      ] = await Promise.all([
        projectApi.getProjectById(selectedProject.id),
        projectApi.getProjectConcepts(selectedProject.id, { page: 1, limit: 50 }),
        projectApi.getProjectImages(selectedProject.id, { page: 1, limit: 50 }),
        projectApi.getProjectVideos(selectedProject.id, { page: 1, limit: 50 }),
        projectApi.getProjectSegmentations(selectedProject.id, { page: 1, limit: 50 })
      ]);
      
      console.log('Raw API responses:', {
        projectDetails,
        projectConcepts,
        projectImages,
        projectVideos,
        projectSegmentations
      });
      
      // Set concepts if available
      if (projectConcepts && projectConcepts.success && projectConcepts.data && projectConcepts.data.length > 0) {
        console.log('Setting concepts:', projectConcepts.data);
        setConcepts(projectConcepts.data);
      } else {
        console.log('No concepts found in API response');
        setConcepts(null);
      }
      
      // Set segments/scripts if available first (we need this to map images/videos correctly)
      let segments = [];
      if (projectSegmentations && projectSegmentations.success && projectSegmentations.data && projectSegmentations.data.length > 0) {
        // Take the first segmentation (script) and extract its segments
        const firstSegmentation = projectSegmentations.data[0];
        if (firstSegmentation.segments && firstSegmentation.segments.length > 0) {
          segments = firstSegmentation.segments.map(seg => ({
            id: seg.segmentId || seg.id,
            visual: seg.visual,
            animation: seg.animation,
            narration: seg.narration,
            s3Key: seg.s3Key || seg.image_s3_key || seg.imageS3Key,
            imageUrl: seg.imageUrl || seg.image_url,
            videoUrl: seg.videoUrl || seg.video_url
          }));
          
          console.log('Setting selected script with segments:', segments);
          setSelectedScript({ 
            segments,
            artStyle: firstSegmentation.artStyle,
            concept: firstSegmentation.concept
          });
        } else {
          console.log('No segments found in segmentation data');
          setSelectedScript(null);
        }
      } else {
        console.log('No segmentations found in API response');
        setSelectedScript(null);
      }

      // Set images if available - map to segments properly
      if (projectImages && projectImages.success && Array.isArray(projectImages.data) && projectImages.data.length > 0) {
        const imagesMap = {};
        projectImages.data.forEach(img => {
          const segmentId = img.uuid || img.segment_id || img.segmentId || img.id;
          if (!segmentId) return;

          // Support old s3Key as well as new imageS3Key / imageS3key
          const key = img.s3Key || img.imageS3Key || img.imageS3key || img.image_s3_key;
          const imageUrl = key ? `https://ds0fghatf06yb.cloudfront.net/${key}` : (img.url || img.imageUrl);
          if (imageUrl) {
            imagesMap[segmentId] = imageUrl;

            // update segment data so we can reuse for video generation
            const segment = segments.find(seg => seg.id == segmentId);
            if (segment && !segment.s3Key) {
              segment.s3Key = key;
            }
          }
        });
        console.log('Setting generated images:', imagesMap);
        setGeneratedImages(imagesMap);
      } else {
        console.log('No images found in API response');
        setGeneratedImages({});
      }
 
      // Set videos if available - map to segments properly (supports new videoFiles array)
      if (projectVideos && projectVideos.success && Array.isArray(projectVideos.data) && projectVideos.data.length > 0) {
        const videosMap = {};
        projectVideos.data.forEach(video => {
          const segmentId = video.uuid || video.segment_id || video.segmentId || video.id;
          if (!segmentId) return;

          let videoKey = null;
          if (Array.isArray(video.s3Keys) && video.s3Keys.length > 0) {
            videoKey = video.s3Keys[0];
          } else if (Array.isArray(video.videoFiles) && video.videoFiles.length > 0) {
            videoKey = video.videoFiles[0].s3Key;
          }

          const videoUrl = videoKey ? `https://ds0fghatf06yb.cloudfront.net/${videoKey}` : (video.url || null);
          if (videoUrl) {
            videosMap[segmentId] = videoUrl;
          }
        });
        console.log('Setting generated videos:', videosMap);
        setGeneratedVideos(videosMap);
        setStoredVideosMap(videosMap);
      } else {
        console.log('No videos found in API response');
        setGeneratedVideos({});
        setStoredVideosMap({});
      }
      
      // Reset other states
      setSelectedConcept(null);
      setScripts(null);
      
      console.log('Project data loading completed');
      
    } catch (error) {
      console.error("Error loading project data from API:", error);
      setError("Failed to load project data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setNewProjectName("");
    setNewProjectDesc("");
    setCreateProjectError(null);
    setCreateModalOpen(true);
    setTimeout(() => nameInputRef.current?.focus(), 100);
  };

  const closeCreateModal = () => {
    setCreateModalOpen(false);
    setCreateProjectError(null);
  };

  const handleCreateProjectModal = async (e) => {
    e.preventDefault();
    setCreateProjectError(null);
    if (!newProjectName.trim()) {
      setCreateProjectError("Project name is required.");
      return;
    }
    setCreatingProject(true);
    try {
      const newProject = await projectApi.createProject({ name: newProjectName, description: newProjectDesc });
      clearProjectLocalStorage();
      localStorage.setItem('project-store-selectedProject', JSON.stringify(newProject));
      localStorage.setItem('project-store-projects', JSON.stringify([newProject]));
      setSelectedProject(newProject);
      resetFlow();
      setCreateModalOpen(false);
    } catch (err) {
      setCreateProjectError(err.message || 'Failed to create project.');
    } finally {
      setCreatingProject(false);
    }
  };

  const SelectedProjectBanner = () => {
    if (!selectedProject) return null;
    return (
      <div className="px-4 py-2 bg-blue-900 text-blue-100 text-sm border-b border-blue-800">
        Working on: <span className="font-semibold">{selectedProject.name}</span>
      </div>
    );
  };

  // helper maps combining stored data so UI shows even after reload
  const combinedVideosMap = React.useMemo(() => ({ ...generatedVideos, ...storedVideosMap }), [generatedVideos, storedVideosMap]);

  return (
    <div className='z-10' onClick={() => {
        setShowMenu(false);
        setShowUserMenu(false);
      }}>


      {/* Chat Interface */}
      <div
        className="fixed inset-0 w-full h-full bg-white dark:bg-gray-800 text-white z-[10000] flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className='flex justify-between items-center p-4 bg-gray-900 border-b border-gray-800 sticky top-0 z-[10005]'>
          <div className='flex items-center gap-2 relative'>
            {/* Hamburger */}
            <button
              className='text-white text-xl focus:outline-none hover:text-gray-300'
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu((v) => !v);
              }}
              title='Menu'
            >
              ☰
            </button>

            {/* Dropdown Menu */}
            {showMenu && (
              <div
                className='absolute left-0 mt-2 w-48 bg-black/90 backdrop-blur-md border border-white/20 p-2 rounded-lg flex flex-col gap-2 z-[10002] text-sm'
                onClick={(e) => e.stopPropagation()}
              >
                {isAuthenticated && (
                  <>
                    <button
                      className='w-full flex items-center gap-2 px-3 py-1 hover:bg-gray-700 rounded'
                      onClick={() => setShowProjectHistory((v) => !v)}
                    >
                      🕒 <span>Project History</span>
                    </button>
                    <button
                      onClick={() => setShowCharacterGenerator(true)}
                      className='w-full flex items-center gap-2 px-3 py-1 hover:bg-gray-700 rounded'
                    >
                      👤 <span>Generate Character</span>
                    </button>
                    <button
                      onClick={openCreateModal}
                      className='w-full flex items-center gap-2 px-3 py-1 hover:bg-gray-700 rounded'
                    >
                      ➕ <span>Create Project</span>
                    </button>
                  </>
                )}
              </div>
            )}
            {isAuthenticated && (
              <>
                {showProjectHistory && (
                  <div className='absolute left-48 top-10 z-[10002]'>
                    <ProjectHistoryDropdown
                      onSelect={() => setShowProjectHistory(false)}
                    />
                  </div>
                )}
              </>
            )}
            {isAuthenticated && user && (
              <div className='relative ml-2'>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowUserMenu((v) => !v);
                    setShowMenu(false);
                  }}
                  className='flex items-center gap-1 focus:outline-none'
                >
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt='Profile'
                      className='w-7 h-7 rounded-full border border-gray-600'
                    />
                  ) : (
                    <div className='w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center'>
                      <span className='text-white text-xs font-medium'>
                        {user.name?.charAt(0) || user.email?.charAt(0) || 'U'}
                      </span>
                    </div>
                  )}
                  <svg
                    xmlns='http://www.w3.org/2000/svg'
                    className='w-3 h-3 text-gray-300'
                    fill='none'
                    viewBox='0 0 24 24'
                    stroke='currentColor'
                  >
                    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 9l-7 7-7-7' />
                  </svg>
                </button>

                {showUserMenu && (
                  <div
                    className='absolute right-0 mt-2 w-44 bg-black/90 backdrop-blur-md border border-white/20 text-white rounded-md shadow-lg p-2 z-[10002] text-sm'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className='px-2 py-1 border-b border-gray-700 mb-1'>{user.name || user.email}</div>
                    <button
                      onClick={logout}
                      className='w-full text-left px-2 py-1 hover:bg-gray-800 rounded'
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>


        </div>
        
        {/* Credit Widget Section */}
        {isAuthenticated && (
          <div className='px-3 py-2 bg-gray-900/50 border-b border-gray-800'>
            <CreditWidget />
          </div>
        )}
        
        {/* Credit Deduction Notification */}
        {creditDeductionMessage && (
          <div className='px-3 py-2 bg-green-900/50 border-b border-green-800'>
            <div className='flex items-center gap-2 text-green-200'>
              <span>💰</span>
              <span className='text-xs'>{creditDeductionMessage}</span>
            </div>
          </div>
        )}
        

        {isAuthenticated && <SelectedProjectBanner />}

        <div className='flex-1 overflow-hidden flex flex-row'>
          {/* Left step panel */}
          <div className='w-64 border-r border-gray-800 overflow-y-auto'>
            <StepList
            steps={steps}
            stepStatus={stepStatus}
            currentStep={currentStep}
            loading={loading}
            collapseSteps={collapseSteps}
            setCollapseSteps={setCollapseSteps}
            isStepDisabled={isStepDisabled}
            getStepIcon={getStepIcon}
            handleStepClick={handleStepClick}
            handleRedoStep={handleRedoStep}
            setCurrentStep={setCurrentStep}
          />
          </div>


          {/* Content Area */}
          <div className='flex-1 overflow-y-auto p-4'>
            {error && (
              <div className='mb-4 p-3 bg-red-900 text-red-100 rounded text-sm'>
                {error}
                <button
                  onClick={() => setError(null)}
                  className='ml-2 text-red-300 hover:text-red-100'
                >
                  ✕
                </button>
              </div>
            )}

            {loading && (
              <div className='flex items-center justify-center py-8'>
                <LoadingSpinner />
                <span className='ml-2 text-gray-300'>Processing...</span>
              </div>
            )}

            {/* Concepts Selection */}
            {concepts && (currentStep === 1 || (concepts.length > 0 && stepStatus[1] === 'pending')) && (
              <div className='mb-4'>
                <h4 className='text-sm font-semibold text-white mb-2'>
                  Choose a Concept: (Current Step: {currentStep}, Step Status: {stepStatus[1]})
                </h4>
                <div className='space-y-2'>
                  {concepts.map((concept, index) => (
                    <button
                      key={index}
                      onClick={() => handleConceptSelect(concept)}
                      className='w-full p-3 bg-gray-800 border border-gray-700 rounded text-left hover:bg-gray-700 hover:border-gray-600 transition-colors'
                    >
                      <div className='text-white font-medium text-sm mb-1'>{concept.title}</div>
                      <div className='text-gray-300 text-xs mb-2'>{concept.concept}</div>
                      <div className='flex flex-wrap gap-1'>
                        <span className='px-2 py-1 bg-blue-600 text-blue-100 text-xs rounded'>Tone: {concept.tone}</span>
                        <span className='px-2 py-1 bg-green-600 text-green-100 text-xs rounded'>Goal: {concept.goal}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Scripts Selection */}
            {scripts && (currentStep === 2 || currentStep === 3) && (
              <div className='mb-4'>
                <h4 className='text-sm font-semibold text-white mb-2'>Choose a Script:</h4>
                <div className='space-y-2'>
                  <button
                    onClick={() => handleScriptSelect(scripts.response1)}
                    className='w-full p-3 bg-gray-800 border border-gray-700 rounded text-left hover:bg-gray-700 hover:border-gray-600 transition-colors'
                  >
                    <div className='text-white font-medium text-sm mb-1'>Script Option 1</div>
                    <div className='text-gray-300 text-xs'>{scripts.response1.segments.length} segments</div>
                  </button>
                  <button
                    onClick={() => handleScriptSelect(scripts.response2)}
                    className='w-full p-3 bg-gray-800 border border-gray-700 rounded text-left hover:bg-gray-700 hover:border-gray-600 transition-colors'
                  >
                    <div className='text-white font-medium text-sm mb-1'>Script Option 2</div>
                    <div className='text-gray-300 text-xs'>{scripts.response2.segments.length} segments</div>
                  </button>
                </div>
              </div>
            )}

            {/* Show selected concept when step 1 is clicked */}
            {selectedConcept && currentStep === 1 && (
              <div className='mb-4'>
                <h4 className='text-sm font-semibold text-white mb-2'>Selected Concept:</h4>
                <div className='p-3 bg-gray-800 border border-gray-700 rounded'>
                  <div className='text-white font-medium text-sm mb-1'>{selectedConcept.title}</div>
                  <div className='text-gray-300 text-xs mb-2'>{selectedConcept.concept}</div>
                  <div className='flex flex-wrap gap-1'>
                    <span className='px-2 py-1 bg-blue-600 text-blue-100 text-xs rounded'>Tone: {selectedConcept.tone}</span>
                    <span className='px-2 py-1 bg-green-600 text-green-100 text-xs rounded'>Goal: {selectedConcept.goal}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Show selected script when step 3 is clicked */}
            {selectedScript && currentStep === 3 && (
              <div className='mb-4'>
                <h4 className='text-sm font-semibold text-white mb-2'>Selected Script:</h4>
                <div className='p-3 bg-gray-800 border border-gray-700 rounded'>
                  <div className='text-white font-medium text-sm mb-1'>Script with {selectedScript.segments.length} segments</div>
                  <div className='text-gray-300 text-xs mb-2'>Art Style: {selectedScript.artStyle || 'Default'}</div>
                  <div className='space-y-1'>
                    {selectedScript.segments.slice(0, 3).map((segment, index) => (
                      <div key={index} className='text-gray-400 text-xs'>
                        Segment {segment.id}: {segment.visual.substring(0, 50)}...
                      </div>
                    ))}
                    {selectedScript.segments.length > 3 && (
                      <div className='text-gray-500 text-xs'>... and {selectedScript.segments.length - 3} more segments</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Model Selection - show when step 4 or 5 is active */}
            {(currentStep === 4 || currentStep === 5) && (
              <div className='mb-4'>
                <h4 className='text-sm font-semibold text-white mb-2'>AI Model Selection:</h4>
                <div className='space-y-3'>
                  {currentStep === 4 && (
                    <div>
                      <label className='block text-xs text-gray-400 mb-1'>Image Generation Model:</label>
                      <ModelSelector
                        genType="IMAGE"
                        selectedModel={selectedImageModel}
                        onModelChange={setSelectedImageModel}
                        disabled={loading}
                        className="w-full"
                      />
                      {/* Button to trigger image generation */}
                      {stepStatus[4] !== 'done' && (
                        <button
                          onClick={runImageGeneration}
                          disabled={loading}
                          className={`mt-2 w-full px-3 py-2 rounded-md text-sm font-medium text-white ${loading ? 'bg-gray-600 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                        >
                          {loading ? 'Generating…' : 'Generate Images'}
                        </button>
                      )}
                    </div>
                  )}
                  {currentStep === 5 && (
                    <div>
                      <label className='block text-xs text-gray-400 mb-1'>Video Generation Model:</label>
                      <ModelSelector
                        genType="VIDEO"
                        selectedModel={selectedVideoModel}
                        onModelChange={setSelectedVideoModel}
                        disabled={loading}
                        className="w-full"
                      />
                      {/* Button to trigger video generation */}
                      {stepStatus[5] !== 'done' && (
                        <button
                          onClick={runVideoGeneration}
                          disabled={loading || Object.keys(generatedImages).length === 0}
                          className={`mt-2 w-full px-3 py-2 rounded-md text-sm font-medium text-white ${(loading || Object.keys(generatedImages).length === 0) ? 'bg-gray-600 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                        >
                          {loading ? 'Generating…' : 'Generate Videos'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Generation Progress - show when any generation step is active */}
            {Object.keys(generationProgress).length > 0 && (currentStep === 4 || currentStep === 5) && (
              <div className='mb-4'>
                <h4 className='text-sm font-semibold text-white mb-2'>Generation Progress:</h4>
                <div className='space-y-2'>
                  {Object.entries(generationProgress).map(([segmentId, progress]) => (
                    <div key={segmentId} className='flex items-center justify-between p-2 bg-gray-800 rounded'>
                      <span className='text-gray-300 text-xs'>Segment {segmentId}</span>
                      <div className='flex items-center gap-2'>
                        {progress.status === "generating" && (
                          <>
                            <div className='w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin'></div>
                            <span className='text-blue-400 text-xs'>Generating {progress.type}...</span>
                          </>
                        )}
                        {progress.status === "completed" && (
                          <span className='text-green-400 text-xs'>✓ {progress.type} completed</span>
                        )}
                        {progress.status === "error" && (
                          <span className='text-red-400 text-xs'>✗ {progress.type} failed</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Generated Images - show when step 4 or 5 is active */}
            {Object.keys(generatedImages).length > 0 && (currentStep === 4 || currentStep === 5) && (
              <div className='mb-4'>
                <h4 className='text-sm font-semibold text-white mb-2'>Generated Images:</h4>
                <div className='grid grid-cols-2 gap-2'>
                  {Object.entries(generatedImages).map(([segmentId, imageUrl]) => (
                    <div
                      key={segmentId}
                      className='relative group cursor-pointer'
                      onClick={() => {
                        setModalImageUrl(imageUrl);
                        setShowImageModal(true);
                      }}>
                      <img
                        src={imageUrl}
                        alt={`Generated image for segment ${segmentId}`}
                        className='w-full h-20 object-cover rounded border border-gray-700 cursor-pointer'
                        onClick={() => {
                          setModalImageUrl(imageUrl);
                          setShowImageModal(true);
                        }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                      <div className='absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all duration-200 rounded flex items-center justify-center'>
                        <span className='text-white text-xs opacity-0 group-hover:opacity-100'>Segment {segmentId}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Generated Videos - show when step 5 is active */}
            {Object.keys(combinedVideosMap).length > 0 && currentStep === 5 && (
              <div className='mb-4'>
                <h4 className='text-sm font-semibold text-white mb-2'>Generated Videos:</h4>
                <div className='grid grid-cols-2 gap-2'>
                  {Object.entries(combinedVideosMap).map(([segmentId, videoUrl]) => (
                    <div
                      key={segmentId}
                      className='relative group cursor-pointer'
                      onClick={() => {
                        setModalVideoUrl(videoUrl);
                        setShowVideoModal(true);
                      }}>
                      <video
                        src={videoUrl}
                        className='w-full h-20 object-cover rounded border border-gray-700 cursor-pointer'
                        muted
                        loop
                        onClick={() => {
                          setModalVideoUrl(videoUrl);
                          setShowVideoModal(true);
                        }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                                                                                        />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Script Details Section */}
            {selectedScript && (currentStep === 2 || currentStep === 3 || currentStep === 4 || currentStep === 5) && (
              <div className='mb-6'>
                <h4 className='text-lg font-semibold text-white mb-3'>Script Details</h4>
                <div className="bg-gray-800 border border-gray-700 rounded p-4 mb-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-400">Total Segments:</span>
                      <span className="text-white ml-2 font-medium">{selectedScript.segments.length}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Art Style:</span>
                      <span className="text-white ml-2 font-medium">{selectedScript.artStyle || 'Default'}</span>
                    </div>
                    {selectedConcept && (
                      <div className="col-span-2">
                        <span className="text-gray-400">Selected Concept:</span>
                        <span className="text-white ml-2 font-medium">{selectedConcept.title}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Script Segments List */}
                  <div className="mt-4">
                    <h5 className="text-md font-semibold text-white mb-2">Script Segments:</h5>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {selectedScript.segments.map((segment, index) => {
                        const segmentId = segment.id || segment.segmentId || segment.uuid || index;
                        return (
                          <div key={segmentId} className="bg-gray-900 border border-gray-700 rounded p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-blue-400 font-medium">Segment {segmentId}</span>
                              <span className="text-gray-500 text-xs">#{index + 1}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                              <div>
                                <span className="text-gray-400">Visual Prompt:</span>
                                <div className="text-gray-300 mt-1 bg-gray-800 p-2 rounded whitespace-pre-wrap break-words">
                                  {(() => { const raw = segment.visual || 'No visual prompt'; const txt = stripMarkdown(raw); return txt.length > 120 ? (<><span>{txt.slice(0,120)}… </span><span className='text-blue-400 underline cursor-pointer' onClick={()=>{setModalText(txt); setShowTextModal(true);}}>Read</span></>) : txt; })()}
                                </div>
                              </div>
                              <div>
                                <span className="text-gray-400">Animation Prompt:</span>
                                <div className="text-gray-300 mt-1 bg-gray-800 p-2 rounded whitespace-pre-wrap break-words">
                                  {(() => { const raw = segment.animation || segment.visual || 'No animation prompt'; const txt = stripMarkdown(raw); return txt.length > 120 ? (<><span>{txt.slice(0,120)}… </span><span className='text-blue-400 underline cursor-pointer' onClick={()=>{setModalText(txt); setShowTextModal(true);}}>Read</span></>) : txt; })()}
                                </div>
                              </div>
                              <div className="md:col-span-2">
                                <span className="text-gray-400">Narration:</span>
                                <div className="text-gray-300 mt-1 bg-gray-800 p-2 rounded whitespace-pre-wrap break-words">
                                  {(() => { const raw = segment.narration || 'No narration'; const txt = stripMarkdown(raw); return txt.length > 120 ? (<><span>{txt.slice(0,120)}… </span><span className='text-blue-400 underline cursor-pointer' onClick={()=>{setModalText(txt); setShowTextModal(true);}}>Read</span></>) : txt; })()}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

                        {/* Segment Details Table - show when on image/video steps or when project data is loaded */}
            {selectedProject && selectedScript && (currentStep === 4 || currentStep === 5 || Object.keys(generatedImages).length > 0 || Object.keys(generatedVideos).length > 0) && (
              <div className='mb-6'>
                <div className="flex items-center justify-between mb-4">
                  <h4 className='text-xl font-bold text-white'>Segment Details Table</h4>
                  <div className="flex gap-2 text-sm">
                    <span className="px-3 py-1 bg-green-900 text-green-300 rounded-full">
                      {Object.keys(generatedImages).length} Images
                    </span>
                    <span className="px-3 py-1 bg-blue-900 text-blue-300 rounded-full">
                      {Object.keys(generatedVideos).length} Videos
                    </span>
                  </div>
                </div>
                
                <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                                         <table className="w-full text-[13px] border-collapse border border-gray-700 whitespace-pre-wrap">
                       <thead className="sticky top-0 z-10">
                         <tr className="bg-gray-800 border-b border-gray-700">
                           <th className="p-3 text-left text-white font-semibold text-xs uppercase tracking-wide border-r border-gray-700">Segment</th>
                           <th className="p-3 text-left text-white font-semibold text-xs uppercase tracking-wide border-r border-gray-700">Visual Prompt</th>
                           <th className="p-3 text-left text-white font-semibold text-xs uppercase tracking-wide border-r border-gray-700">Animation Prompt</th>
                           <th className="p-3 text-left text-white font-semibold text-xs uppercase tracking-wide border-r border-gray-700">Narration</th>
                           <th className="p-3 text-left text-white font-semibold text-xs uppercase tracking-wide border-r border-gray-700">Generated Image</th>
                           <th className="p-3 text-left text-white font-semibold text-xs uppercase tracking-wide border-r border-gray-700">Generated Video</th>
                           <th className="p-3 text-left text-white font-semibold text-xs uppercase tracking-wide">Status</th>
                         </tr>
                       </thead>
                      <tbody>
                        {selectedScript.segments.map((segment, index) => {
                          const segmentId = segment.id || segment.segmentId || segment.uuid || index;
                          const imageUrl = generatedImages[segmentId] || generatedImages[`seg-${segmentId}`] || segment.imageUrl || segment.image_url;
                          const videoUrl = generatedVideos[segmentId] || generatedVideos[`seg-${segmentId}`] || segment.videoUrl || segment.video_url;
                          const imageS3Key = segment.s3Key || segment.image_s3_key || segment.imageS3Key;
                          const videoS3Key = segment.video_s3_key || segment.videoS3Key;
                          
                          return (
                                                         <tr key={segmentId} className="border-b border-gray-700 even:bg-gray-900 odd:bg-gray-800 hover:bg-gray-700 transition-colors">
                               <td className="p-4 align-top border-r border-gray-700 leading-relaxed">
                                <div className="flex items-center gap-2">
                                  <span className="text-blue-400 font-bold text-lg">#{segmentId}</span>
                                  <span className="text-gray-400 text-xs">Segment {index + 1}</span>
                                </div>
                              </td>
                                                             <td className="p-4 align-top border-r border-gray-700 leading-relaxed">
                                 <div className="max-w-xs">
                                   <div className="text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
                                     {(() => { const raw = segment.visual || 'No visual prompt'; const txt = stripMarkdown(raw); return txt.length > 120 ? (<><span>{txt.slice(0,120)}… </span><span className='text-blue-400 underline cursor-pointer' onClick={()=>{setModalText(txt); setShowTextModal(true);}}>Read</span></>) : txt; })()}
                                   </div>
                                   {imageS3Key && (
                                     <div className="mt-1 text-xs text-gray-500 break-all">
                                       S3: {imageS3Key.substring(0, 20)}...
                                     </div>
                                   )}
                                 </div>
                               </td>
                               <td className="p-4 align-top border-r border-gray-700 leading-relaxed">
                                 <div className="max-w-xs">
                                   <div className="text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
                                     {(() => { const raw = segment.animation || segment.visual || 'No animation prompt'; const txt = stripMarkdown(raw); return txt.length > 120 ? (<><span>{txt.slice(0,120)}… </span><span className='text-blue-400 underline cursor-pointer' onClick={()=>{setModalText(txt); setShowTextModal(true);}}>Read</span></>) : txt; })()}
                                   </div>
                                   {videoS3Key && (
                                     <div className="mt-1 text-xs text-gray-500 break-all">
                                       S3: {videoS3Key.substring(0, 20)}...
                                     </div>
                                   )}
                                 </div>
                               </td>
                               <td className="p-4 align-top border-r border-gray-700 leading-relaxed">
                                 <div className="max-w-xs">
                                   <div className="text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
                                     {(() => { const raw = segment.narration || 'No narration'; const txt = stripMarkdown(raw); return txt.length > 120 ? (<><span>{txt.slice(0,120)}… </span><span className='text-blue-400 underline cursor-pointer' onClick={()=>{setModalText(txt); setShowTextModal(true);}}>Read</span></>) : txt; })()}
                                   </div>
                                 </div>
                               </td>
                               <td className="p-4 align-top border-r border-gray-700 leading-relaxed">
                                {imageUrl ? (
                                  <div className="flex flex-col items-center gap-2">
                                    <div className="relative group">
                                      <img 
                                        src={imageUrl} 
                                        alt={`Segment ${segmentId} image`}
                                        className="w-16 h-16 object-cover rounded-lg border-2 border-gray-600 cursor-pointer hover:border-blue-400 transition-colors shadow-lg"
                                        onClick={() => {
                                          setModalImageUrl(imageUrl);
                                          setShowImageModal(true);
                                        }}
                                        onError={(e) => {
                                          e.target.style.display = 'none';
                                        }}
                                      />
                                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all rounded-lg flex items-center justify-center">
                                        <span className="text-white text-xs opacity-0 group-hover:opacity-100">Click to view</span>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => {
                                        setModalImageUrl(imageUrl);
                                        setShowImageModal(true);
                                      }}
                                      className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                                    >
                                      View Full
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center">
                                    <div className="w-16 h-16 bg-gray-700 rounded-lg border-2 border-dashed border-gray-600 flex items-center justify-center">
                                      <span className="text-gray-500 text-xs">No Image</span>
                                    </div>
                                  </div>
                                )}
                              </td>
                                                             <td className="p-4 align-top border-r border-gray-700 leading-relaxed">
                                 {videoUrl ? (
                                  <div className="flex flex-col items-center gap-2">
                                    <div className="relative group">
                                      <video 
                                        src={videoUrl} 
                                        className="w-16 h-16 object-cover rounded-lg border-2 border-gray-600 cursor-pointer hover:border-blue-400 transition-colors shadow-lg"
                                        muted
                                        loop
                                        onClick={() => {
                                          setModalVideoUrl(videoUrl);
                                          setShowVideoModal(true);
                                        }}
                                        onError={(e) => {
                                          e.target.style.display = 'none';
                                        }}
                                      />
                                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all rounded-lg flex items-center justify-center">
                                        <span className="text-white text-xs opacity-0 group-hover:opacity-100">Click to view</span>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => {
                                        setModalVideoUrl(videoUrl);
                                        setShowVideoModal(true);
                                      }}
                                      className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                                    >
                                      View Full
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center">
                                    <div className="w-16 h-16 bg-gray-700 rounded-lg border-2 border-dashed border-gray-600 flex items-center justify-center">
                                      <span className="text-gray-500 text-xs">No Video</span>
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td className="p-3">
                                <div className="flex flex-col gap-2">
                                  {imageUrl && (
                                    <div className="flex items-center gap-2">
                                      <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                                      <span className="text-green-400 text-xs font-medium">Image Ready</span>
                                    </div>
                                  )}
                                  {videoUrl && (
                                    <div className="flex items-center gap-2">
                                      <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                                      <span className="text-blue-400 text-xs font-medium">Video Ready</span>
                                    </div>
                                  )}
                                  {!imageUrl && !videoUrl && (
                                    <div className="flex items-center gap-2">
                                      <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                                      <span className="text-gray-500 text-xs">Pending</span>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                
                {/* Summary Stats */}
                <div className="mt-4 p-4 bg-gray-800 rounded-lg">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="text-center">
                      <div className="text-white font-bold text-lg">{selectedScript.segments.length}</div>
                      <div className="text-gray-400 text-xs">Total Segments</div>
                    </div>
                    <div className="text-center">
                      <div className="text-green-400 font-bold text-lg">{Object.keys(generatedImages).length}</div>
                      <div className="text-gray-400 text-xs">Images Generated</div>
                    </div>
                    <div className="text-center">
                      <div className="text-blue-400 font-bold text-lg">{Object.keys(generatedVideos).length}</div>
                      <div className="text-gray-400 text-xs">Videos Generated</div>
                    </div>
                    <div className="text-center">
                      <div className="text-purple-400 font-bold text-lg">{selectedScript.artStyle || 'Default'}</div>
                      <div className="text-gray-400 text-xs">Art Style</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Generated Content Summary - show when step 4 or 5 is clicked */}
            {selectedScript && (currentStep === 4 || currentStep === 5) && (
              <div className='mb-4'>
                <h4 className='text-sm font-semibold text-white mb-2'>Generated Content:</h4>
                <div className='space-y-2'>
                  <div className='text-xs text-gray-400'>
                    Segments: {selectedScript.segments.length}
                  </div>
                  {Object.keys(generatedImages).length > 0 && (
                    <div className='text-xs text-gray-400'>
                      Images: {Object.keys(generatedImages).length}/{selectedScript.segments.length}
                    </div>
                  )}
                  {Object.keys(generatedVideos).length > 0 && (
                    <div className='text-xs text-gray-400'>
                      Videos: {Object.keys(generatedVideos).length}/{selectedScript.segments.length}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Timeline Button */}
            {canSendTimeline && (
              <div className='mb-4'>
                {/* <button
                  onClick={sendVideosToTimeline}
                  disabled={addingTimeline}
                  className='w-full px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded font-medium disabled:opacity-50 flex items-center justify-center gap-2'
                >
                  {addingTimeline ? (
                    <>
                      <div className='w-4 h-4'><LoadingSpinner /></div>
                      <span>Adding to Timeline...</span>
                    </>
                  ) : (
                    <>
                      <span>➕</span>
                      <span>Add Videos to Timeline</span>
                    </>
                  )}
                </button> */}
              </div>
            )}

            {/* Auth/Project Messages */}
            {!isAuthenticated && (
              <div className='text-center p-6 bg-gray-800 border border-gray-700 rounded-lg'>
                <div className='mb-4'>
                  <h3 className='text-lg font-semibold text-white mb-2'>Welcome to Usuals.ai</h3>
                  <p className='text-gray-400 text-sm'>Sign in to access AI-powered video creation features</p>
                </div>
                <ChatLoginButton />
              </div>
            )}

            {isAuthenticated && !selectedProject && (
              <div className='text-center p-6 bg-gray-800 border border-gray-700 rounded-lg'>
                <div className='mb-4'>
                  <h3 className='text-lg font-semibold text-white mb-2'>No Project Selected</h3>
                  <p className='text-gray-400 text-sm'>Please create or select a project to start creating video content</p>
                </div>
                <button
                  onClick={openCreateModal}
                  className='bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-md font-medium'
                >
                  Create New Project
                </button>
              </div>
            )}
          </div>

          {/* Input area */}
          <InputArea
            isAuthenticated={isAuthenticated}
            selectedProject={selectedProject}
            prompt={prompt}
            setPrompt={setPrompt}
            loading={loading}
            currentStep={currentStep}
            handleStepClick={handleStepClick}
          />
        </div>
      </div>

      {/* Character Generator Modal */}
      <CharacterGenerator
        isOpen={showCharacterGenerator}
        onClose={() => setShowCharacterGenerator(false)}
      />

      {/* Create Project Modal */}
      {createModalOpen && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[10003]">
          <form onSubmit={handleCreateProjectModal} className="bg-gray-800 p-4 rounded-lg shadow-lg w-96 flex flex-col gap-3 relative">
            <h3 className="text-lg font-semibold text-white mb-2">Create New Project</h3>
            <label className="text-xs text-gray-300 mb-1">Project Name</label>
            <input
              ref={nameInputRef}
              className="p-2 rounded bg-gray-700 text-white border border-gray-600 focus:outline-none"
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              disabled={creatingProject}
              required
              autoFocus
            />
            <label className="text-xs text-gray-300 mb-1">Description (optional)</label>
            <textarea
              className="p-2 rounded bg-gray-700 text-white border border-gray-600 focus:outline-none resize-y min-h-[60px] max-h-[300px]"
              value={newProjectDesc}
              onChange={e => setNewProjectDesc(e.target.value)}
              disabled={creatingProject}
              rows={4}
              style={{ minHeight: 60 }}
            />
            {createProjectError && <div className="text-xs text-red-400">{createProjectError}</div>}
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                className="flex-1 bg-gray-600 hover:bg-gray-500 text-white rounded px-2 py-1"
                onClick={closeCreateModal}
                disabled={creatingProject}
              >Cancel</button>
              <button
                type="submit"
                className="flex-1 bg-green-600 hover:bg-green-500 text-white rounded px-2 py-1"
                disabled={creatingProject || !newProjectName.trim()}
              >{creatingProject ? "Creating..." : "Create"}</button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* Image preview modal */}
      {showImageModal && modalImageUrl && createPortal(
        <div
          className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[10003]"
          onClick={() => {
            setShowImageModal(false);
            setModalImageUrl(null);
          }}
        >
          <img
            src={modalImageUrl}
            alt="Preview"
            className="max-w-full max-h-full rounded shadow-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-lg font-bold"
            onClick={(e) => {
              e.stopPropagation();
              setShowImageModal(false);
              setModalImageUrl(null);
            }}
          >
            ✕
          </button>
        </div>,
        document.body
      )}

      {/* Text preview modal */}
      {showTextModal && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[10003]" onClick={() => setShowTextModal(false)}>
          <div className="bg-gray-800 max-w-xl max-h-[80vh] overflow-y-auto p-8 rounded-lg relative" onClick={e => e.stopPropagation()}>
            <button className="absolute top-2 right-2 text-white text-lg font-bold" onClick={() => setShowTextModal(false)}>✕</button>
            <pre className="whitespace-pre-wrap text-gray-200 text-sm">{modalText}</pre>
          </div>
        </div>,
        document.body
      )}

      {/* Video preview modal */}
      {showVideoModal && modalVideoUrl && createPortal(
        <div
          className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[10003]"
          onClick={() => {
            setShowVideoModal(false);
            setModalVideoUrl(null);
          }}
        >
          <video
            src={modalVideoUrl}
            controls
            autoPlay
            className="max-w-full max-h-full rounded shadow-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-lg font-bold"
            onClick={(e) => {
              e.stopPropagation();
              setShowVideoModal(false);
              setModalVideoUrl(null);
            }}
          >
            ✕
          </button>
        </div>,
        document.body
      )}

      {/* Redo modal with model selection */}
      {showRedoModal && createPortal(
        <div
          className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[10003]"
          onClick={() => setShowRedoModal(false)}
        >
          <div
            className="bg-gray-800 p-6 rounded-lg shadow-lg w-96 flex flex-col gap-4 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-2">
              Redo {redoStepId === 4 ? 'Image' : 'Video'} Generation
            </h3>
            <p className="text-gray-300 text-sm">
              Choose a different AI model for regeneration:
            </p>
            
            {redoStepId === 4 && (
              <div>
                <label className="block text-xs text-gray-300 mb-1">Image Generation Model</label>
                <ModelSelector
                  genType="IMAGE"
                  selectedModel={redoImageModel}
                  onModelChange={setRedoImageModel}
                  disabled={loading}
                  className="w-full"
                />
              </div>
            )}
            
            {redoStepId === 5 && (
              <div>
                <label className="block text-xs text-gray-300 mb-1">Video Generation Model</label>
                <ModelSelector
                  genType="VIDEO"
                  selectedModel={redoVideoModel}
                  onModelChange={setRedoVideoModel}
                  disabled={loading}
                  className="w-full"
                />
              </div>
            )}
            
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                className="flex-1 bg-gray-600 hover:bg-gray-500 text-white rounded px-4 py-2"
                onClick={() => setShowRedoModal(false)}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded px-4 py-2"
                onClick={handleRedoWithModel}
                disabled={loading}
              >
                {loading ? "Processing..." : "Redo Generation"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// Wrapper component to keep the public <ChatWidget /> API small.
// Manages only the "open" state & publish-button visibility then delegates
// all heavy UI / logic to <ChatWidgetSidebar />.
function ChatWidget() {
  // Hide Electron publish button while chat widget is mounted
  React.useEffect(() => {
    const btn = document.getElementById("publish-button");
    if (btn) btn.style.display = "none";
    return () => {
      if (btn) btn.style.display = "";
    };
  }, []);

  return <ChatWidgetSidebar />;
}

export default ChatWidget;