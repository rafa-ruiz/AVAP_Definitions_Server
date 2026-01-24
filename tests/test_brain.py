# tests/test_brain.py
import grpc
import sys
# Truco: Generar las clases al vuelo para no compilar protos manualmente
from grpc_reflection.v1alpha import reflection
# (Ojo: Para esto necesitarías habilitar reflexión en Node o compilar los protos aquí)