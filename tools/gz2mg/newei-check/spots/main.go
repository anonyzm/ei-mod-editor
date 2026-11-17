// Put the hero on many open spots of a zone (no other creatures) and check that orders move him from there.
package main

import (
	"fmt"
	"math/rand"
	"os"
	"runtime"
	"sort"

	"newei/engine"
	"newei/gl"
	"newei/win"
)

func main() {
	runtime.LockOSThread()
	w, err := win.Open("spots", 64, 64, false)
	if err != nil {
		panic(err)
	}
	defer w.Close()
	if err := gl.Init(); err != nil {
		panic(err)
	}
	a, err := engine.OpenAssets(`C:\GOG Games\EI_edit\Evil Islands`)
	if err != nil {
		panic(err)
	}
	c, _ := engine.NewGame(a)
	zone := "gz2mg"
	if len(os.Args) > 1 {
		zone = os.Args[1]
	}
	z, _, err := c.Enter(zone, 1, 12)
	if err != nil {
		panic(err)
	}
	for _, u := range z.Units {
		if !u.Party {
			z.Kill(u)
		}
	}
	h := z.Party()[0]
	g := z.Grid()
	W, H := float32(g.W)*0.5, float32(g.H)*0.5
	open := func(x, y float32) bool { return g.Open(3, int(x/0.5), int(y/0.5)) }
	rng := rand.New(rand.NewSource(11))
	bad := map[[2]int]int{}
	n := 0
	for k := 0; k < 4000; k++ {
		x, y := rng.Float32()*W, rng.Float32()*H
		if !open(x, y) {
			continue
		}
		n++
		h.Pos[0], h.Pos[1] = x, y
		ok := 0
		for j := 0; j < 6; j++ {
			var tx, ty float32
			for t := 0; t < 200; t++ {
				tx, ty = x+(rng.Float32()*2-1)*10, y+(rng.Float32()*2-1)*10
				if tx > 0 && ty > 0 && tx < W && ty < H && open(tx, ty) {
					break
				}
			}
			if z.MoveTo(h, tx, ty) {
				ok++
			}
		}
		if ok == 0 {
			bad[[2]int{int(x / 8), int(y / 8)}]++
			if len(bad) <= 4 && bad[[2]int{int(x / 8), int(y / 8)}] == 1 {
				gr := z.Graph
				nx, ny := int(x/4), int(y/4)
				n := ny*gr.W + nx
				costs := []int16{}
				for d := 0; d < 8; d++ {
					costs = append(costs, int16(gr.Layers[3].Cost[n*8+d]))
				}
				tx, ty := x+6, y
				wps := engine.FindPath(gr, 3, [2]float32{x, y}, [2]float32{tx, ty})
				pts, _ := engine.RefinePath(g, 3, [2]float32{x, y}, wps, false)
				fmt.Printf("BAD %.2f %.2f node %d,%d costs %v wps %v refined %d pts; fine open around:\n", x, y, nx, ny, costs, wps, len(pts))
				cx, cy := int(x/0.5), int(y/0.5)
				for dy := 4; dy >= -4; dy-- {
					line := "   "
					for dx := -8; dx <= 8; dx++ {
						if dx == 0 && dy == 0 {
							line += "@"
						} else if g.Open(3, cx+dx, cy+dy) {
							line += "."
						} else {
							line += "#"
						}
					}
					fmt.Println(line)
				}
			}
		}
	}
	keys := make([][2]int, 0, len(bad))
	for k := range bad {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return bad[keys[i]] > bad[keys[j]] })
	fmt.Printf("%s: %d open spots tried, %d 8-m squares with spots that cannot move\n", zone, n, len(keys))
	for i, k := range keys {
		if i >= 40 {
			break
		}
		fmt.Printf("  square x %d..%d y %d..%d: %d spots\n", k[0]*8, k[0]*8+8, k[1]*8, k[1]*8+8, bad[k])
	}
}
