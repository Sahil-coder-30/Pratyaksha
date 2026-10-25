#How to run : Open new terminal
#             cd BigFish 
#             $env:USE_TF = "0"
#             python -m ML.src.workers.ner


from transformers import pipeline

from ML.src.schema import Detection

class NERDetector:
    def __init__(
        self,
        model_name: str = "dslim/bert-base-NER",
        device: int = -1,
    ):
        # device=-1: CPU
        # device=0: first CUDA GPU
        self.ner = pipeline(
            task="token-classification",
            model=model_name,
            aggregation_strategy="simple",
            device=device,
        )

    
    def detect(
        self,
        text: str,
        *,
        context_id: str | None = None,
    ) -> list[Detection]:
        if not text or not text.strip():
            return []

        predictions = self.ner(text)
        detections = []

        for entity in predictions:
            start = int(entity["start"])
            end = int(entity["end"])

            # Validate offsets before extracting the entity text.
            if start < 0 or end <= start or end > len(text):
                continue

            detections.append(
                Detection(
                    type=str(entity["entity_group"]).upper(),
                    source="NER",
                    confidence=float(entity["score"]),
                    text=text[start:end],
                    text_span={
                        "start": start,
                        "end": end,
                    },
                    context_id="ocr_text",
                )
            )

        return detections



if __name__ == "__main__":
    detector = NERDetector()

    text = (
        "John Smith works at Acme Corporation "
        "and lives in New Delhi."
    )

    for detection in detector.detect(text):
        print(detection.to_dict())
