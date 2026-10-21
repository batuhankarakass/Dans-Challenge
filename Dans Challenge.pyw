# Cift tikla: oyun konsol penceresi olmadan, tam ekran uygulama penceresinde acilir.
# Pencere kapaninca sunucu da kapanir.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "oyun"))
import serve  # noqa: E402

serve.main(app=True)
