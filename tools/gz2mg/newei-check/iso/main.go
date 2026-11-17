// Count graph nodes of a zone whose class-3 edges are all closed while the fine grid around the node centre is open.
package main

import (
	"fmt"
	"os"
	"runtime"

	"newei/engine"
	"newei/gl"
	"newei/win"
)

func main() {
	runtime.LockOSThread()
	w, _ := win.Open("iso", 64, 64, false)
	defer w.Close()
	gl.Init()
	a, err := engine.OpenAssets(`C:\GOG Games\EI_edit\Evil Islands`)
	if err != nil {
		panic(err)
	}
	for _, mob := range os.Args[1:] {
		z, err := engine.LoadZone(a, mob, "", 12)
		if err != nil {
			fmt.Println(mob, err)
			continue
		}
		g, gr := z.Grid(), z.Graph
		iso, total, cellsIn, cellsAll := 0, 0, 0, 0
		for ny := 0; ny < gr.H; ny++ {
			for nx := 0; nx < gr.W; nx++ {
				openCells := 0
				for dy := 0; dy < 8; dy++ {
					for dx := 0; dx < 8; dx++ {
						if g.Open(3, nx*8+dx, ny*8+dy) {
							openCells++
						}
					}
				}
				if openCells < 1 {
					continue
				}
				total++
				closed := true
				for d := 0; d < 8; d++ {
					if int16(gr.Layers[3].Cost[(ny*gr.W+nx)*8+d]) >= 0 {
						closed = false
					}
				}
				if closed {
					iso++
					cellsIn += openCells
				}
				cellsAll += openCells
			}
		}
		fmt.Printf("%s: %d of %d open nodes have no open edge\n", mob, iso, total)
		z.Free()
	}
}
