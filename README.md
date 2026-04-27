# Residual Growth


Residual Growth is an interactive computational artwork that transforms a leaf into a shared digital surface where viewers’ gestures generate real-time traces of damage, depletion, and infection.

---

## Project Overview

Residual Growth is a real-time interactive artwork about leaf damage, natural traces, and shared digital surfaces. The work begins with a photographed leaf image, which is translated into an ASCII-based visual field through pixel sampling. Viewers can interact with the leaf surface through hand gestures, applying different biotic forces such as chewing, piercing-sucking, and fungal infection.

Each interaction mode creates a different visual state:

- **Chewing** removes characters and creates holes or broken edges.
- **Piercing-sucking** fades, shrinks, and displaces characters to suggest depletion.
- **Fungal infection** creates pale grey-green marks and soft spreading overlays.

The project uses code as a central creative medium. Instead of producing a static image, the system runs live in the browser and updates in real time through audience interaction.

---

## Concept

This project comes from my interest in natural traces, damaged surfaces, and material change. A leaf surface contains many forms of information, including veins, holes, disease marks, damaged edges, and changes caused by insects, microorganisms, and time.

In this work, the leaf is treated as both a natural object and a shared interface. The ASCII character system allows the leaf image to become a set of discrete computational units. These units can be removed, faded, shifted, recoloured, or covered through interaction.

The work explores how natural traces can be translated into computational rules, and how audience gestures can act as biotic forces on a digital surface.

---

## Technologies Used

- **JavaScript**
- **p5.js** – image loading, pixel sampling, and real-time drawing
- **MediaPipe Hands** – hand tracking and gesture recognition
- **Node.js** – local server
- **Socket.io** – multiplayer synchronisation
- **HTML / CSS** – browser-based display

---

## Interaction

Hand tracking is the main interaction method.

| Gesture | Mode | Effect |
|---|---|---|
| One raised index finger | Chewing | Removes characters and creates broken edges |
| Index + middle fingers | Piercing-sucking | Shrinks, fades, and shifts characters |
| Index + middle + ring fingers | Fungal infection | Adds pale spreading and powdery marks |
| Open palm | Explore | Allows movement without changing the leaf |

Mouse and touch input are also included as testing and fallback controls.

Keyboard controls:

| Key | Action |
|---|---|
| `R` | Reset shared world |
| `F` | Toggle fullscreen |
| `H` | Hide / show interface |
| `C` | Hide / show hand cursor |

---

## Multiplayer System

The multiplayer system is built with Socket.io. The server stores a shared `worldState`, which records the traces left by viewers, including:

- position
- interaction mode
- radius
- movement direction

When a viewer creates a new mark, the client sends the event to the server. The server then broadcasts the updated state to all connected clients, so all viewers see the same changing leaf surface.
