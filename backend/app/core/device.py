def get_best_device() -> str:
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    return "cpu"


def get_device_info() -> dict:
    try:
        import torch
        if torch.cuda.is_available():
            return {
                "device": "cuda",
                "cuda_available": True,
                "gpu_name": torch.cuda.get_device_name(0),
                "gpu_count": torch.cuda.device_count(),
            }
    except ImportError:
        pass
    return {
        "device": "cpu",
        "cuda_available": False,
        "gpu_name": None,
        "gpu_count": 0,
    }
