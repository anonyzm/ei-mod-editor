// Random walks of the hero over gz2mg in New EI: find spots where he stops and no order moves him any more.
package main

import (
	"fmt"
	"math"
	"math/rand"
	"os"
	"runtime"

	"newei/engine"
	"newei/gl"
	"newei/win"
)

const dir = `C:\GOG Games\EI_edit\Evil Islands`

func main() {
	runtime.LockOSThread()
	w, err := win.Open("walk", 64, 64, false)
	if err != nil {
		panic(err)
	}
	defer w.Close()
	if err := gl.Init(); err != nil {
		panic(err)
	}
	a, err := engine.OpenAssets(dir)
	if err != nil {
		panic(err)
	}
	c, _ := engine.NewGame(a)
	z, _, err := c.Enter("gz2mg", 1, 12)
	if err != nil {
		panic(err)
	}
	quiet := len(os.Args) > 1 && os.Args[1] == "quiet"
	if quiet { // only the hero: rule out fights and other creatures' stamps
		for _, u := range z.Units {
			if !u.Party {
				z.Kill(u)
			}
		}
	}
	h := z.Party()[0]
	h.HP, h.MaxHP = 1e6, 1e6
	now := 0.0
	tick := func(n int) {
		for i := 0; i < n; i++ {
			now += engine.TickSeconds
			z.Update(now)
		}
	}
	g := z.Grid()
	open := func(x, y float32) bool { return g.Open(3, int(x/0.5), int(y/0.5)) }
	rng := rand.New(rand.NewSource(7))
	pick := func(cx, cy, r float32) (float32, float32) {
		for k := 0; k < 500; k++ {
			x, y := cx+(rng.Float32()*2-1)*r, cy+(rng.Float32()*2-1)*r
			if x > 2 && y > 2 && x < 318 && y < 254 && open(x, y) {
				return x, y
			}
		}
		return cx, cy
	}
	stuck := 0
	for i := 0; i < 400; i++ {
		tx, ty := pick(h.Pos[0], h.Pos[1], 60)
		ok := z.MoveTo(h, tx, ty)
		if !ok {
			continue
		}
		last, still := h.Pos, 0
		for t := 0; t < 4000 && still < 120; t++ {
			tick(1)
			if math.Hypot(float64(h.Pos[0]-last[0]), float64(h.Pos[1]-last[1])) < 0.01 {
				still++
			} else {
				still = 0
			}
			last = h.Pos
		}
		// can he leave from here?
		moved := 0
		for k := 0; k < 8; k++ {
			x, y := pick(h.Pos[0], h.Pos[1], 12)
			if z.MoveTo(h, x, y) {
				moved++
			}
		}
		if moved == 0 {
			stuck++
			cx, cy := int(h.Pos[0]/0.5), int(h.Pos[1]/0.5)
			fmt.Printf("STUCK #%d at %.2f %.2f (target %.1f %.1f) own cell open=%v nibble=%04x\n", stuck, h.Pos[0], h.Pos[1], tx, ty, g.Open(3, cx, cy), g.Nibble[cy*g.W+cx])
			for dy := -3; dy <= 3; dy++ {
				line := ""
				for dx := -3; dx <= 3; dx++ {
					if g.Open(3, cx+dx, cy+dy) {
						line += "."
					} else {
						line += "#"
					}
				}
				fmt.Println("   ", line)
			}
			for _, u := range z.Units {
				if d := math.Hypot(float64(u.Pos[0]-h.Pos[0]), float64(u.Pos[1]-h.Pos[1])); d < 8 && u != h {
					fmt.Printf("    near %-22s proto=%-22s d=%.2f dead=%v hp=%.0f player=%d pos=%.2f,%.2f\n", u.In.Obj.Name, u.In.Obj.Proto, d, u.Dead(), u.HP, u.In.Obj.Player, u.Pos[0], u.Pos[1])
				}
			}
			fmt.Printf("    hero hp=%.0f path=%d target=%v\n", h.HP, len(h.Path), h.Target != nil)
			if stuck > 6 {
				break
			}
			// move him out by hand and go on
			x, y := pick(h.Pos[0], h.Pos[1], 30)
			h.Pos[0], h.Pos[1] = x, y
		}
	}
	fmt.Println("walks done, stuck", stuck, "hero at", h.Pos)
}
